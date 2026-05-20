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
build_output <- function(elo_df, season, conf_map = NULL, sos_map = NULL) {

  df <- elo_df[order(-elo_df$elo), ]
  df$rank       <- seq_len(nrow(df))
  df$season     <- as.integer(season)
  df$win_pct    <- round(ifelse(df$games_played > 0,
                                df$wins / df$games_played, NA_real_), 3)
  df$record     <- paste0(df$wins, "-", df$losses)
  df$conference <- if (!is.null(conf_map)) conf_map[df$team]  else NA_character_
  df$sos        <- if (!is.null(sos_map))  round(sos_map[df$team], 1) else NA_real_
  df$updated_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")

  if (!"best_win_team" %in% names(df)) df$best_win_team <- NA_character_
  if (!"best_win_elo"  %in% names(df)) df$best_win_elo  <- NA_real_
  df$best_win_elo <- round(as.numeric(df$best_win_elo), 1)

  df[, c("season","rank","team","conference","elo","wins","losses",
         "games_played","win_pct","record",
         "best_win_team","best_win_elo","sos","updated_at")]
}

message("[elo_engine] loaded.")
