# ================================================================
# R/elo_engine.R
# Shared Elo calculation engine used by every sport update script.
#
# UNIFORM OUTPUT COLUMNS (all CSVs produced by this site):
#   season, rank, team, conference, elo, wins, losses, games_played,
#   win_pct, record, best_win_team, best_win_elo, sos, updated_at
# ================================================================

# ── Core Elo loop ──────────────────────────────────────────────────────────────
#' @param games  data.frame: winner | loser | winner_pts | loser_pts
#' @param k      base K-factor
#' @param iters  iterations (games re-processed this many times for convergence)
#' @param min_games  teams below this threshold get their rating halved each iter
#' @return data.frame: team | elo | wins | losses | games_played
run_elo <- function(games, k = 30, iters = 10, min_games = 4) {

  stopifnot(all(c("winner","loser","winner_pts","loser_pts") %in% names(games)))

  all_teams <- unique(c(games$winner, games$loser))
  n         <- length(all_teams)
  idx       <- setNames(seq_len(n), all_teams)

  elo  <- rep(1500.0, n)
  wins <- integer(n)
  loss <- integer(n)

  for (iter in seq_len(iters)) {
    for (i in seq_len(nrow(games))) {
      wi <- idx[[ games$winner[i] ]]
      li <- idx[[ games$loser[i]  ]]
      if (is.na(wi) || is.na(li)) next

      rw <- elo[wi]; rl <- elo[li]
      ew <- 1.0 / (1.0 + 10^((rl - rw) / 400.0))

      margin <- as.numeric(games$winner_pts[i]) - as.numeric(games$loser_pts[i])
      margin <- max(margin, 1)             # ensure positive
      adj_k  <- k * log(margin + 1)
      delta  <- adj_k * (1.0 - ew)

      elo[wi] <- rw + delta
      elo[li] <- rl - delta
      wins[wi] <- wins[wi] + 1L
      loss[li] <- loss[li] + 1L
    }
    # Penalise teams with very few games (early-season noise control)
    gp <- wins + loss
    elo[gp < min_games] <- elo[gp < min_games] / 2.0
  }

  # True record = total tallies ÷ iters (each game processed iters times)
  data.frame(
    team         = all_teams,
    elo          = round(elo, 1),
    wins         = wins  %/% iters,
    losses       = loss  %/% iters,
    games_played = (wins + loss) %/% iters,
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
  # conf_champ: TRUE if this team won their conference tournament
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

# ── Biggest movers: rolling window vs a checkpointed baseline ─────────────────
#' Attaches baseline_elo / baseline_date / elo_change to `out`, where
#' baseline_elo is each team's rating as of the last checkpoint (not simply
#' "last run"). The checkpoint only rolls forward once every `window_days`,
#' so a team's move stays visible in "Biggest Movers" for the rest of that
#' window instead of disappearing at the very next twice-daily update.
#'
#' Mechanics:
#'   - Reads the CSV already on disk at `out_path` (the state from the
#'     previous run) BEFORE it gets overwritten by this run's write_csv().
#'   - If that team's existing checkpoint is younger than `window_days`,
#'     carry it forward unchanged (elo_change grows/shrinks day to day).
#'   - Once the checkpoint is `window_days` or older, reset it to that
#'     team's rating from the previous run (i.e. right before today's
#'     games), so today's results still count toward the new window
#'     instead of being silently absorbed into the reset.
#'   - No prior file / new team / corrupt checkpoint → baseline = 1500
#'     (matches "every team starts the season at 1500" and keeps this
#'     entirely within-season, same as the existing trend indicator).
#'
#' @param out       result of build_output() for this run
#' @param out_path  the path this season's CSV is about to be written to
#' @param window_days  how long a checkpoint stays fixed before rolling (7 = weekly)
attach_movers <- function(out, out_path, window_days = 7, today = Sys.Date()) {
  prev <- tryCatch({
    if (file.exists(out_path)) readr::read_csv(out_path, show_col_types = FALSE) else NULL
  }, error = function(e) NULL)

  has_checkpoint_cols <- !is.null(prev) &&
    all(c("baseline_elo", "baseline_date") %in% names(prev))

  get_prev_row <- function(team) {
    if (is.null(prev)) return(NULL)
    idx <- which(prev$team == team)
    if (!length(idx)) return(NULL)
    prev[idx[1], ]
  }

  n <- nrow(out)
  baseline_elo  <- numeric(n)
  baseline_date <- character(n)

  for (i in seq_len(n)) {
    pr <- get_prev_row(out$team[i])

    if (is.null(pr)) {
      # No previous file, or a team new to this season's data — start the
      # clock now from the neutral season-start rating.
      baseline_elo[i]  <- 1500
      baseline_date[i] <- as.character(today)
      next
    }

    still_fresh <- FALSE
    if (has_checkpoint_cols && !is.na(pr$baseline_date) && !is.na(pr$baseline_elo)) {
      bd  <- suppressWarnings(as.Date(pr$baseline_date))
      age <- if (!is.na(bd)) as.numeric(today - bd) else Inf
      if (!is.na(age) && age < window_days) still_fresh <- TRUE
    }

    if (still_fresh) {
      # Within the window — keep the same checkpoint so movement keeps
      # accumulating against the same starting point.
      baseline_elo[i]  <- as.numeric(pr$baseline_elo)
      baseline_date[i] <- as.character(suppressWarnings(as.Date(pr$baseline_date)))
    } else {
      # Window elapsed (or this CSV predates checkpoint tracking) — reset
      # using the PREVIOUS run's rating (before today's games), so today's
      # results land in the new window rather than vanishing into the reset.
      baseline_elo[i]  <- as.numeric(pr$elo)
      baseline_date[i] <- as.character(today)
    }
  }

  out$baseline_elo  <- round(baseline_elo, 1)
  out$baseline_date <- baseline_date
  out$elo_change    <- round(out$elo - out$baseline_elo, 1)
  out
}

message("[elo_engine] loaded.")


# ── Conference tournament champion detection ──────────────────────────────────
# Fetches ESPN conference tournament results by scanning a date range
# Returns named character vector: shortDisplayName → TRUE (for champs found)
# sport_path: e.g. "basketball/mens-college-basketball"
# date_from / date_to: YYYY-MM-DD strings covering the conference tournament window
fetch_conf_champs <- function(sport_path, season_yr,
                              date_from = NULL, date_to = NULL,
                              groups_param = "") {
  # Default date windows per sport
  if (is.null(date_from)) {
    if (grepl("basketball", sport_path)) {
      # CBB conf tournaments: late Feb to mid-March
      date_from <- paste0(season_yr, "-02-25")
      date_to   <- paste0(season_yr, "-03-16")
    } else {
      # Baseball conf tournaments: mid-May to late May
      date_from <- paste0(season_yr, "-05-15")
      date_to   <- paste0(season_yr, "-05-28")
    }
  }

  ds <- gsub("-","", date_from)
  de <- gsub("-","", date_to)

  # Try postseason scoreboard with date range
  urls_to_try <- c(
    paste0("https://site.api.espn.com/apis/site/v2/sports/", sport_path,
           "/scoreboard?limit=500&dates=", ds, "-", de,
           "&seasontype=3", groups_param),
    paste0("https://site.api.espn.com/apis/site/v2/sports/", sport_path,
           "/scoreboard?limit=500&dates=", ds, "-", de, groups_param)
  )

  champs <- character(0)  # conf_name → winner_shortDisplayName

  for (url_str in urls_to_try) {
    data <- tryCatch(
      jsonlite::fromJSON(url_str, simplifyVector = FALSE),
      error = function(e) NULL
    )
    if (is.null(data) || !length(data$events)) next

    for (ev in data$events) {
      tryCatch({
        # Check notes for "Championship"
        notes     <- ev$notes %||% list()
        note_text <- paste(sapply(notes, function(n) n$headline %||% ""), collapse=" ")
        if (!grepl("Champion", note_text, ignore.case=TRUE)) next

        comp <- ev$competitions[[1]]
        if (!isTRUE(comp$status$type$completed)) next
        comps <- comp$competitors
        if (length(comps) < 2) next

        # Find winner by score
        scores <- sapply(comps, function(c) suppressWarnings(as.numeric(c$score %||% NA)))
        if (any(is.na(scores)) || scores[1] == scores[2]) next
        winner_idx <- which.max(scores)
        winner <- comps[[winner_idx]]$team$shortDisplayName %||%
                  comps[[winner_idx]]$team$displayName %||% ""
        if (!nchar(winner)) next

        # Get conference name from notes or groups
        conf_name <- ""
        for (n in notes) {
          h <- n$headline %||% ""
          # e.g. "ACC Men's Basketball Tournament Championship"
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
          message("    Conf champ: ", conf_name, " → ", winner)
        }
      }, error = function(e) NULL)
    }

    if (length(champs) > 0) break  # got results, stop trying
  }

  champs
}

# Null-coalescing helper
`%||%` <- function(a, b) if (!is.null(a) && length(a) > 0 && !is.na(a[1])) a else b
