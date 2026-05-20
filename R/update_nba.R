# ================================================================
# R/update_nba.R  —  NBA Elo, 2002-current
# Package: hoopR  |  Function: load_nba_schedule(seasons)
# FIX: was checking status_type_completed which isn't always present.
#      Use home_score > 0 OR home_winner != NA as completion signal.
# ================================================================

suppressPackageStartupMessages({
  library(hoopR)
  library(dplyr)
  library(readr)
})
source("R/elo_engine.R")

CURRENT_SEASON <- most_recent_nba_season()
SEASONS        <- 2002:CURRENT_SEASON
OUT_DIR        <- "NBA/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

DIVS <- c(
  "Celtics"="Atlantic",    "Nets"="Atlantic",      "Knicks"="Atlantic",
  "76ers"="Atlantic",      "Raptors"="Atlantic",
  "Bulls"="Central",       "Cavaliers"="Central",  "Pistons"="Central",
  "Pacers"="Central",      "Bucks"="Central",
  "Hawks"="Southeast",     "Hornets"="Southeast",  "Heat"="Southeast",
  "Magic"="Southeast",     "Wizards"="Southeast",
  "Nuggets"="Northwest",   "Timberwolves"="Northwest","Thunder"="Northwest",
  "Trail Blazers"="Northwest","Jazz"="Northwest",
  "Warriors"="Pacific",    "Clippers"="Pacific",   "Lakers"="Pacific",
  "Suns"="Pacific",        "Kings"="Pacific",
  "Mavericks"="Southwest", "Rockets"="Southwest",  "Grizzlies"="Southwest",
  "Pelicans"="Southwest",  "Spurs"="Southwest"
)

build_games <- function(sched) {
  # A completed game has non-NA, non-zero scores
  sched %>%
    filter(
      !is.na(home_score), !is.na(away_score),
      as.integer(home_score) > 0,
      as.integer(away_score) > 0,
      as.integer(home_score) != as.integer(away_score)
    ) %>%
    mutate(
      hs = as.integer(home_score),
      as_ = as.integer(away_score),
      winner     = if_else(hs > as_, home_short_display_name, away_short_display_name),
      loser      = if_else(hs < as_, home_short_display_name, away_short_display_name),
      winner_pts = pmax(hs, as_),
      loser_pts  = pmin(hs, as_)
    ) %>%
    filter(!is.na(winner), !is.na(loser), winner != loser,
           winner != "", loser != "") %>%
    select(winner, loser, winner_pts, loser_pts)
}

for (s in SEASONS) {
  message("NBA ", s, "...")
  g <- tryCatch({
    sched <- load_nba_schedule(seasons = s)
    message("  Rows loaded: ", nrow(sched), " | score col: ",
            if("home_score" %in% names(sched)) "present" else "MISSING")
    if (!"home_score" %in% names(sched)) stop("No home_score column")
    build_games(sched)
  }, error = function(e) {
    message("  schedule failed: ", e$message)
    # Fallback: load_nba_team_box gives team-level rows
    tryCatch({
      box <- load_nba_team_box(seasons = s)
      message("  team_box rows: ", nrow(box))
      box %>%
        filter(season_type == 2,
               !is.na(team_score), !is.na(opponent_team_score),
               as.integer(team_score) > 0) %>%
        group_by(game_id) %>%
        filter(n() == 2) %>%
        slice(1) %>%
        ungroup() %>%
        mutate(
          hs  = as.integer(team_score),
          as_ = as.integer(opponent_team_score)
        ) %>%
        filter(hs != as_) %>%
        mutate(
          winner     = if_else(hs > as_, team_short_display_name,
                               opponent_team_short_display_name),
          loser      = if_else(hs < as_, team_short_display_name,
                               opponent_team_short_display_name),
          winner_pts = pmax(hs, as_),
          loser_pts  = pmin(hs, as_)
        ) %>%
        filter(!is.na(winner), winner != "", winner != loser) %>%
        select(winner, loser, winner_pts, loser_pts)
    }, error = function(e2) { message("  fallback failed: ", e2$message); NULL })
  })

  if (is.null(g) || nrow(g) < 50) {
    message("  Skipping — ", if(is.null(g)) 0 else nrow(g), " games")
    next
  }
  message("  ", nrow(g), " games")

  elo <- run_elo(g, k=25, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season=s, conf_map=DIVS, sos_map=sos)
  write_csv(out, file.path(OUT_DIR, paste0("NBA_Elo_", s, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("NBA done.")
