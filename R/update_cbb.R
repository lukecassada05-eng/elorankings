# ================================================================
# R/update_cbb.R  —  College Basketball Elo, 2003-current
# FIX: Conference lookup now uses `conference_competition == TRUE`
#      rows to build a team_id -> conference_name map.
#      For teams not in that map (non-power-conference), we use
#      groups_name from any game they appear in.
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
OUT_DIR        <- "docs/CBB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

get_cbb_season <- function(season) {
  message("  CBB ", season, "...")
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

    # ── Build team->conference map ─────────────────────────────
    # Strategy: for every game row, both teams are playing in some context.
    # When conference_competition == TRUE, groups_name = the conference name.
    # We can map EITHER team in that game to that conference.
    conf_games <- sched %>%
      filter(isTRUE(conference_competition) | conference_competition == TRUE,
             !is.na(groups_name), groups_name != "")

    # Map home team id -> conference
    home_map <- conf_games %>%
      select(team_id = home_id, team_name = home_short_display_name,
             conference = groups_name) %>%
      distinct(team_id, .keep_all = TRUE)

    # Map away team id -> conference (same conference as home in conf game)
    away_map <- conf_games %>%
      select(team_id = away_id, team_name = away_short_display_name,
             conference = groups_name) %>%
      distinct(team_id, .keep_all = TRUE)

    team_conf_df <- bind_rows(home_map, away_map) %>%
      distinct(team_id, .keep_all = TRUE)

    conf_by_id   <- setNames(team_conf_df$conference, as.character(team_conf_df$team_id))
    conf_by_name <- setNames(team_conf_df$conference, team_conf_df$team_name)

    # ── Build games ────────────────────────────────────────────
    games <- sched %>%
      mutate(
        home_pts   = as.numeric(home_score),
        away_pts   = as.numeric(away_score),
        winner     = if_else(home_pts > away_pts,
                             home_short_display_name, away_short_display_name),
        loser      = if_else(home_pts < away_pts,
                             home_short_display_name, away_short_display_name),
        winner_pts = pmax(home_pts, away_pts),
        loser_pts  = pmin(home_pts, away_pts)
      ) %>%
      filter(!is.na(winner), !is.na(loser), winner != loser) %>%
      select(winner, loser, winner_pts, loser_pts)

    if (nrow(games) == 0) return(NULL)

    # Final conference map: by name (covers all teams that appeared in a conf game)
    conf_map <- conf_by_name

    list(games = games, conf_map = conf_map)
  }, error = function(e) { message("  ERROR: ", e$message); NULL })
}

for (s in SEASONS) {
  res <- get_cbb_season(s)
  if (is.null(res) || nrow(res$games) < 50) {
    message("  Skipping CBB ", s)
    next
  }
  elo <- run_elo(res$games, k=30, iters=10, min_games=4)
  elo <- attach_best_wins(elo, res$games)
  sos <- compute_sos(res$games, elo)
  out <- build_output(elo, season=s, conf_map=res$conf_map, sos_map=sos)
  write_csv(out, file.path(OUT_DIR, paste0("CBB_Elo_", s, ".csv")))
  message("  -> ", nrow(out), " teams, conf: ",
          sum(!is.na(out$conference)), "/", nrow(out))
}
message("CBB done.")
