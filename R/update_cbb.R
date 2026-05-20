# ================================================================
# R/update_cbb.R  —  College Basketball Elo, 2003-current
# Package: hoopR  |  Function: load_mbb_schedule(seasons)
# FIX: conference lookup uses home_conference_id + a direct
#      join on groups_id instead of groups_is_conference flag
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

    # ── Conference lookup ─────────────────────────────────────
    # groups_is_conference is unreliable; instead build lookup from
    # any row where groups_name is non-empty and groups_id is non-NA
    conf_raw <- sched %>%
      filter(!is.na(groups_name), groups_name != "",
             !is.na(groups_id)) %>%
      select(home_id, groups_id, groups_name) %>%
      distinct(home_id, .keep_all = TRUE)

    # Also grab from away side
    conf_raw2 <- sched %>%
      filter(!is.na(groups_name), groups_name != "",
             !is.na(groups_id)) %>%
      select(away_id, groups_id, groups_name) %>%
      distinct(away_id, .keep_all = TRUE) %>%
      rename(home_id = away_id)

    conf_all <- bind_rows(conf_raw, conf_raw2) %>%
      distinct(home_id, .keep_all = TRUE)

    # Map team id -> conference
    conf_by_id <- setNames(conf_all$groups_name, as.character(conf_all$home_id))

    # Build games with conference attached
    games <- sched %>%
      mutate(
        home_pts   = as.numeric(home_score),
        away_pts   = as.numeric(away_score),
        winner     = if_else(home_pts > away_pts,
                             home_short_display_name, away_short_display_name),
        loser      = if_else(home_pts < away_pts,
                             home_short_display_name, away_short_display_name),
        winner_pts = pmax(home_pts, away_pts),
        loser_pts  = pmin(home_pts, away_pts),
        winner_id  = if_else(home_pts > away_pts,
                             as.character(home_id), as.character(away_id)),
        winner_conf = conf_by_id[winner_id]
      ) %>%
      filter(!is.na(winner), !is.na(loser), winner != loser) %>%
      select(winner, loser, winner_pts, loser_pts, winner_conf, winner_id)

    if (nrow(games) == 0) return(NULL)

    # Team -> conference map (from winner side)
    team_conf <- games %>%
      filter(!is.na(winner_conf)) %>%
      select(team = winner, conference = winner_conf) %>%
      distinct(team, .keep_all = TRUE)

    # Also map losers if missing
    loser_ids <- sched %>%
      mutate(
        home_pts = as.numeric(home_score),
        away_pts = as.numeric(away_score),
        loser    = if_else(home_pts < away_pts,
                           home_short_display_name, away_short_display_name),
        loser_id = if_else(home_pts < away_pts,
                           as.character(home_id), as.character(away_id))
      ) %>%
      filter(!is.na(loser)) %>%
      mutate(conference = conf_by_id[loser_id]) %>%
      filter(!is.na(conference)) %>%
      select(team = loser, conference) %>%
      distinct(team, .keep_all = TRUE)

    team_conf <- bind_rows(team_conf, loser_ids) %>%
      distinct(team, .keep_all = TRUE)

    conf_map <- setNames(team_conf$conference, team_conf$team)

    g <- select(games, winner, loser, winner_pts, loser_pts)
    list(games = g, conf_map = conf_map)
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
  message("  -> ", nrow(out), " teams, conf coverage: ",
          sum(!is.na(out$conference)), "/", nrow(out))
}
message("CBB done.")
