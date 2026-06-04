# ================================================================
# R/elo_engine.R
# Shared Elo calculation engine used by every sport update script.
#
# UNIFORM OUTPUT COLUMNS (all CSVs produced by this site):
#   season, rank, team, conference, elo, wins, losses, games_played,
#   win_pct, record, best_win_team, best_win_elo, sos, updated_at
#
# RATING METHODOLOGY — Batch Iterative Elo
# ─────────────────────────────────────────
# Every time new games are added, ALL games of the season are
# re-processed from scratch. Every team resets to 1500 at the
# start of each iteration. Game ORDER does not affect final ratings.
#
# Algorithm (true batch Elo):
#   prev_elo ← all teams at 1500
#   for iter in 1..iters:
#     new_elo ← all teams at 1500 (reset each iteration)
#     for each game:
#       expected_score = f(prev_elo[winner], prev_elo[loser])   ← fixed for this iter
#       delta = adj_k * (1 - expected_score)
#       new_elo[winner] += delta
#       new_elo[loser]  -= delta
#     prev_elo ← new_elo   ← carry forward for next iteration
#   final ratings = prev_elo
#
# Own rating: current accumulating score (starts at 1500 each iteration,
# grows through wins within that iteration — so a team at 1540 after
# game 1 uses 1540 for game 2's expected score).
# Opponent rating: fixed from previous iteration's final output — this
# insulates every team from differences in scheduling order.
# 10 iterations converges to a stable equilibrium.
# ================================================================

# ── Core Elo loop ──────────────────────────────────────────────────────────────
#' @param games  data.frame: winner | loser | winner_pts | loser_pts
#' @param k      base K-factor
#' @param iters  iterations for convergence (games re-processed from scratch each time)
#' @param min_games  teams below this threshold get a rating penalty each iter
#' @return data.frame: team | elo | wins | losses | games_played
run_elo <- function(games, k = 30, iters = 10, min_games = 4) {

  stopifnot(all(c("winner","loser","winner_pts","loser_pts") %in% names(games)))

  all_teams <- unique(c(games$winner, games$loser))
  n         <- length(all_teams)
  idx       <- setNames(seq_len(n), all_teams)

  # Count true wins/losses once (not inside the iteration loop)
  wins <- integer(n)
  loss <- integer(n)
  for (i in seq_len(nrow(games))) {
    wi <- idx[[ games$winner[i] ]]
    li <- idx[[ games$loser[i]  ]]
    if (!is.na(wi) && !is.na(li)) {
      wins[wi] <- wins[wi] + 1L
      loss[li] <- loss[li] + 1L
    }
  }

  # ── Batch iterative Elo ────────────────────────────────────────
  # prev_elo = ratings used for expected-score calculation this iteration
  # new_elo  = accumulates updates for this iteration (starts at 1500 each time)
  # After each iteration, prev_elo ← new_elo for next pass.
  # Game order within each iteration is irrelevant because all expected
  # scores are computed from prev_elo (fixed for the whole iteration).

  prev_elo <- rep(1500.0, n)

  for (iter in seq_len(iters)) {

    new_elo <- rep(1500.0, n)     # reset to 1500 at the start of every iteration

    for (i in seq_len(nrow(games))) {
      wi <- idx[[ games$winner[i] ]]
      li <- idx[[ games$loser[i]  ]]
      if (is.na(wi) || is.na(li)) next

      # Own rating: current accumulating new_elo (starts at 1500, builds through own games)
      # Opponent rating: previous iteration's final rating (insulates from schedule order)
      rw <- new_elo[wi]      # own live running score this iteration
      rl <- prev_elo[li]     # opponent's stable prev-iteration rating
      ew <- 1.0 / (1.0 + 10^((rl - rw) / 400.0))

      # Log-scaled margin of victory K adjustment (diminishing returns)
      margin <- as.numeric(games$winner_pts[i]) - as.numeric(games$loser_pts[i])
      margin <- max(margin, 1)
      adj_k  <- k * log(margin + 1)
      delta  <- adj_k * (1.0 - ew)

      new_elo[wi] <- new_elo[wi] + delta
      new_elo[li] <- new_elo[li] - delta
    }

    # Noise penalty: teams below min_games threshold get their Elo divided by 1.2
    # Applied after each iteration so under-sampled teams stay near baseline
    gp <- wins + loss
    new_elo[gp < min_games] <- new_elo[gp < min_games] / 1.2

    prev_elo <- new_elo   # carry forward to next iteration
  }

  data.frame(
    team         = all_teams,
    elo          = round(prev_elo, 1),
    wins         = wins,
    losses       = loss,
    games_played = wins + loss,
    stringsAsFactors = FALSE
  )
}

# ── Best-win annotation ────────────────────────────────────────────────────────
#' Attach the best-win (highest-Elo opponent beaten) to each team.
attach_best_wins <- function(elo_df, games) {
  elo_lup <- setNames(elo_df$elo, elo_df$team)

  winners <- unique(games$winner)
  best_df <- do.call(rbind, lapply(winners, function(w) {
    rows      <- which(games$winner == w)
    opp_elos  <- elo_lup[ games$loser[rows] ]
    best_i    <- which.max(opp_elos)
    if (length(best_i) == 0) return(NULL)
    data.frame(
      team          = w,
      best_win_team = games$loser[ rows[best_i] ],
      best_win_elo  = as.numeric(opp_elos[best_i]),
      stringsAsFactors = FALSE
    )
  }))

  merge(elo_df, best_df, by = "team", all.x = TRUE)
}

# ── Schedule strength ─────────────────────────────────────────────────────────
#' Average Elo of all opponents faced.
compute_sos <- function(games, elo_df) {
  elo_lup <- setNames(elo_df$elo, elo_df$team)
  all_t   <- unique(c(games$winner, games$loser))
  sapply(setNames(all_t, all_t), function(t) {
    opps <- c(games$loser[games$winner == t],
              games$winner[games$loser  == t])
    if (length(opps) == 0) return(NA_real_)
    mean(elo_lup[opps], na.rm = TRUE)
  })
}

# ── Build uniform output CSV ──────────────────────────────────────────────────
#' Produces the standard 14-column output for every sport.
#'
#' @param elo_df   result of attach_best_wins()
#' @param season   integer year
#' @param conf_map named character vector  team -> conference/division
#' @param sos_map  named numeric vector    team -> SOS
build_output <- function(elo_df, season, conf_map = NULL, sos_map = NULL, conf_champ_map = NULL) {

  df <- elo_df[order(-elo_df$elo), ]
  df$rank       <- seq_len(nrow(df))
  df$season     <- as.integer(season)
  df$win_pct    <- round(ifelse(df$games_played > 0,
                                df$wins / df$games_played, NA_real_), 3)
  df$record     <- paste0(df$wins, "-", df$losses)
  df$conference <- if (!is.null(conf_map)) conf_map[df$team]  else NA_character_
  df$sos        <- if (!is.null(sos_map))  round(sos_map[df$team], 1) else NA_real_
  df$conf_champ <- if (!is.null(conf_champ_map)) {
    as.logical(conf_champ_map[df$team])
  } else NA
  df$updated_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")

  if (!"best_win_team" %in% names(df)) df$best_win_team <- NA_character_
  if (!"best_win_elo"  %in% names(df)) df$best_win_elo  <- NA_real_
  df$best_win_elo <- round(as.numeric(df$best_win_elo), 1)

  df[, c("season","rank","team","conference","elo","wins","losses",
         "games_played","win_pct","record",
         "best_win_team","best_win_elo","sos","conf_champ","updated_at")]
}

message("[elo_engine] loaded — batch iterative Elo v2.")


# ── Conference tournament champion detection ──────────────────────────────────
# Fetches ESPN conference tournament results by scanning a date range
# Returns named character vector: shortDisplayName → TRUE (for champs found)
fetch_conf_champs <- function(sport_path, season_yr,
                              date_from = NULL, date_to = NULL,
                              groups_param = "") {
  if (is.null(date_from)) {
    if (grepl("basketball", sport_path)) {
      date_from <- paste0(season_yr, "-02-25")
      date_to   <- paste0(season_yr, "-03-16")
    } else {
      date_from <- paste0(season_yr, "-05-15")
      date_to   <- paste0(season_yr, "-05-28")
    }
  }

  ds <- gsub("-","", date_from)
  de <- gsub("-","", date_to)

  urls_to_try <- c(
    paste0("https://site.api.espn.com/apis/site/v2/sports/", sport_path,
           "/scoreboard?limit=500&dates=", ds, "-", de,
           "&seasontype=3", groups_param),
    paste0("https://site.api.espn.com/apis/site/v2/sports/", sport_path,
           "/scoreboard?limit=500&dates=", ds, "-", de, groups_param)
  )

  champs <- character(0)

  for (url_str in urls_to_try) {
    data <- tryCatch(
      jsonlite::fromJSON(url_str, simplifyVector = FALSE),
      error = function(e) NULL
    )
    if (is.null(data) || !length(data$events)) next

    for (ev in data$events) {
      tryCatch({
        notes     <- ev$notes %||% list()
        note_text <- paste(sapply(notes, function(n) n$headline %||% ""), collapse=" ")
        if (!grepl("Champion", note_text, ignore.case=TRUE)) next

        comp <- ev$competitions[[1]]
        if (!isTRUE(comp$status$type$completed)) next
        comps <- comp$competitors
        if (length(comps) < 2) next

        scores <- sapply(comps, function(c) suppressWarnings(as.numeric(c$score %||% NA)))
        if (any(is.na(scores)) || scores[1] == scores[2]) next
        winner_idx <- which.max(scores)
        winner <- comps[[winner_idx]]$team$shortDisplayName %||%
                  comps[[winner_idx]]$team$displayName %||% ""
        if (!nchar(winner)) next

        conf_name <- ""
        for (n in notes) {
          h <- n$headline %||% ""
          conf_name <- gsub("(Men's|Women's|Basketball|Baseball|Tournament|Championship|Conference).*", "", h, ignore.case=TRUE)
          conf_name <- trimws(conf_name)
          if (nchar(conf_name) > 1) break
        }
        if (!nchar(conf_name)) {
          grps <- ev$groups %||% list()
          if (length(grps)) conf_name <- grps[[1]]$shortName %||% grps[[1]]$name %||% ""
        }

        if (nchar(conf_name) > 0 && !conf_name %in% names(champs)) {
          champs[conf_name] <- winner
          message("    Conf champ: ", conf_name, " -> ", winner)
        }
      }, error = function(e) NULL)
    }

    if (length(champs) > 0) break
  }

  champs
}

# Null-coalescing helper
`%||%` <- function(a, b) if (!is.null(a) && length(a) > 0 && !is.na(a[1])) a else b
