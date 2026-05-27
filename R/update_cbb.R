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
SEASONS        <- 2003:(CURRENT_SEASON + 1L)  # +1 catches next season if started
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
    # Use ALL rows with non-empty groups_name, not just conference_competition.
    # This covers many more teams since non-conf games also carry groups_name.
    # Priority: conference_competition games first, then any groups_name row.

    # Step 1: from conference games (most reliable)
    conf_rows <- sched %>%
      filter(isTRUE(conference_competition) | conference_competition == TRUE,
             !is.na(groups_name), trimws(groups_name) != "")

    # Step 2: from ANY game with groups_name (catches remaining teams)
    any_rows <- sched %>%
      filter(!is.na(groups_name), trimws(groups_name) != "",
             !grepl("^[0-9]+$", trimws(groups_name)))  # exclude numeric group IDs

    # Build maps: team_name -> conference
    build_map <- function(df) {
      if (nrow(df) == 0) return(character(0))
      home <- setNames(df$groups_name, df$home_short_display_name)
      away <- setNames(df$groups_name, df$away_short_display_name)
      both <- c(home, away)
      # Deduplicate: prefer the first assignment
      both[!duplicated(names(both))]
    }

    conf_map_priority <- build_map(conf_rows)
    conf_map_any      <- build_map(any_rows)

    # Merge: priority map wins, fill gaps with any_rows map
    all_names  <- unique(c(names(conf_map_priority), names(conf_map_any)))
    conf_map <- ifelse(
      !is.na(conf_map_priority[all_names]),
      conf_map_priority[all_names],
      conf_map_any[all_names]
    )
    names(conf_map) <- all_names
    conf_map <- conf_map[!is.na(names(conf_map)) & names(conf_map) != ""]

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

  # ── Conference tournament champion detection ──────────────
  # After conf tournaments end (early March), use actual champs for auto bids
  champs_raw <- tryCatch(
    fetch_conf_champs("basketball/mens-college-basketball", s, "&groups=50"),
    error = function(e) character(0)
  )
  # Build champ_map: team_name → TRUE
  # champs_raw is conf_name → team_shortDisplayName
  # We need to match to our canonical team names via conf_map
  conf_champ_map <- NULL
  if (length(champs_raw) > 0) {
    # Map shortDisplayName to canonical using existing conf_map
    all_teams <- names(res$conf_map)
    champ_teams <- character(0)
    for (team in champs_raw) {
      # Exact match first
      if (team %in% all_teams) {
        champ_teams <- c(champ_teams, team)
      } else {
        # Fuzzy: find closest match
        matched <- agrep(team, all_teams, ignore.case=TRUE, value=TRUE, max.distance=0.15)
        if (length(matched) > 0) champ_teams <- c(champ_teams, matched[1])
      }
    }
    if (length(champ_teams) > 0) {
      conf_champ_map <- setNames(rep(FALSE, length(all_teams)), all_teams)
      conf_champ_map[champ_teams] <- TRUE
      message("  Conf champs found: ", paste(champ_teams, collapse=", "))
    }
  }

  out <- build_output(elo, season=s, conf_map=res$conf_map, sos_map=sos,
                      conf_champ_map=conf_champ_map)
  write_csv(out, file.path(OUT_DIR, paste0("CBB_Elo_", s, ".csv")))
  message("  -> ", nrow(out), " teams, conf: ",
          sum(!is.na(out$conference)), "/", nrow(out),
          if (!is.null(conf_champ_map)) paste0(", champs: ", sum(out$conf_champ, na.rm=TRUE)) else "")
}
