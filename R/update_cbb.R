# ================================================================
# R/update_cbb.R
# College Basketball Elo, 2003-current
# Package : hoopR
# Key fn  : load_mbb_schedule(seasons)
# Verified cols (from YOUR working code):
#   home_score, away_score, home_short_display_name,
#   away_short_display_name, date, home_id, away_id,
#   groups_is_conference, groups_name
# ================================================================

suppressPackageStartupMessages({
  library(hoopR)
  library(dplyr)
  library(readr)
  library(lubridate)
})
source("R/elo_engine.R")

Sys.setenv(TZ = "America/New_York")

CURRENT_SEASON <- most_recent_mbb_season()
SEASONS        <- 2003:CURRENT_SEASON
OUT_DIR        <- "CBB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Helper: fetch + clean one CBB season ─────────────────────
get_cbb_season <- function(season) {
  message("  Fetching CBB ", season, "...")
  tryCatch({
    sched <- load_mbb_schedule(seasons = season) %>%
      mutate(date = as.Date(date)) %>%
      filter(
        home_id != away_id,
        !is.na(home_id), !is.na(away_id),
        !is.na(home_score), !is.na(away_score),
        as.numeric(home_score) != as.numeric(away_score),
        date <= Sys.Date()
      )
    if (nrow(sched) == 0) return(NULL)

    # Conference lookup
    conf_lup <- sched %>%
      filter(isTRUE(groups_is_conference)) %>%
      transmute(team = home_short_display_name, conference = groups_name) %>%
      distinct(team, .keep_all = TRUE)

    games <- sched %>%
      mutate(
        home_pts = as.numeric(home_score),
        away_pts = as.numeric(away_score),
        winner   = if_else(home_pts > away_pts,
                           home_short_display_name, away_short_display_name),
        loser    = if_else(home_pts < away_pts,
                           home_short_display_name, away_short_display_name),
        winner_pts = pmax(home_pts, away_pts),
        loser_pts  = pmin(home_pts, away_pts)
      ) %>%
      filter(!is.na(winner), !is.na(loser), winner != loser) %>%
      select(winner, loser, winner_pts, loser_pts)

    list(games = games, conf = conf_lup)
  }, error = function(e) { message("  ERROR: ", e$message); NULL })
}

# ── Per-season Elo ────────────────────────────────────────────
for (s in SEASONS) {
  res <- get_cbb_season(s)
  if (is.null(res) || nrow(res$games) < 50) { message("  Skipping CBB ", s); next }

  g        <- res$games
  conf_map <- setNames(res$conf$conference, res$conf$team)

  elo <- run_elo(g, k = 30, iters = 10, min_games = 4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season = s, conf_map = conf_map, sos_map = sos)

  write_csv(out, file.path(OUT_DIR, paste0("CBB_Elo_", s, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("CBB done.")
