# ================================================================
# R/update_nba.R
# NBA Elo by season, 2002-current
# Package : hoopR
# Key fn  : load_nba_schedule(seasons)
# Verified cols (from official docs):
#   home_score, away_score,
#   home_short_display_name, away_short_display_name,
#   status_type_completed, type_abbreviation (for game type)
# Note: load_nba_schedule IS available; the issue report from Oct 2025
#       was fixed by hoopR 3.1.0. We use it and fall back to
#       load_nba_team_box if it fails.
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

# ── Division map (short display names) ───────────────────────
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

# ── Helper: build games from schedule ─────────────────────────
build_nba_games_from_schedule <- function(sched) {
  sched %>%
    filter(
      # Regular season only (type_abbreviation == "STD" or type_id == 2)
      !is.na(home_score), !is.na(away_score),
      as.integer(home_score) != as.integer(away_score),
      isTRUE(status_type_completed)
    ) %>%
    mutate(
      home_pts = as.integer(home_score),
      away_pts = as.integer(away_score),
      winner   = if_else(home_pts > away_pts,
                         home_short_display_name, away_short_display_name),
      loser    = if_else(home_pts < away_pts,
                         home_short_display_name, away_short_display_name),
      winner_pts = pmax(home_pts, away_pts),
      loser_pts  = pmin(home_pts, away_pts)
    ) %>%
    filter(!is.na(winner), !is.na(loser), winner != loser) %>%
    select(winner, loser, winner_pts, loser_pts)
}

# ── Per-season Elo ─────────────────────────────────────────────
for (s in SEASONS) {
  message("NBA ", s, "...")
  g <- tryCatch({
    sched <- load_nba_schedule(seasons = s)
    build_nba_games_from_schedule(sched)
  }, error = function(e) {
    message("  load_nba_schedule failed: ", e$message)
    # Fallback: load_nba_team_box gives one row per team per game
    tryCatch({
      box <- load_nba_team_box(seasons = s)
      # Each game_id has 2 rows (home+away). Filter completed reg-season games.
      box <- box %>% filter(season_type == 2)
      # Self-join to get both teams' scores per game
      home <- box %>%
        filter(!is.na(team_score), !is.na(opponent_team_score)) %>%
        group_by(game_id) %>%
        filter(n() == 2) %>%
        slice(1) %>%   # one row per game
        ungroup() %>%
        mutate(
          home_name  = team_short_display_name,
          away_name  = opponent_team_short_display_name,
          home_score = as.integer(team_score),
          away_score = as.integer(opponent_team_score)
        ) %>%
        filter(home_score != away_score) %>%
        mutate(
          winner     = if_else(home_score > away_score, home_name, away_name),
          loser      = if_else(home_score < away_score, home_name, away_name),
          winner_pts = pmax(home_score, away_score),
          loser_pts  = pmin(home_score, away_score)
        ) %>%
        filter(!is.na(winner), !is.na(loser), winner != loser) %>%
        select(winner, loser, winner_pts, loser_pts)
      home
    }, error = function(e2) {
      message("  Fallback also failed: ", e2$message); NULL
    })
  })

  if (is.null(g) || nrow(g) < 50) { message("  Skipping"); next }

  elo <- run_elo(g, k = 25, iters = 10, min_games = 4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season = s, conf_map = DIVS, sos_map = sos)

  write_csv(out, file.path(OUT_DIR, paste0("NBA_Elo_", s, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("NBA done.")
