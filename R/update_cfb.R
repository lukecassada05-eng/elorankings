# ================================================================
# R/update_cfb.R
# College Football Elo, 2001-current
# Package : cfbfastR
# Key fn  : cfbd_game_info(year, season_type)
# Verified cols: home_team, away_team, home_points, away_points
# Requires env var: CFBD_API_KEY
#   Get free key: https://collegefootballdata.com/key
#   Add as GitHub secret named CFBD_API_KEY
# ================================================================

suppressPackageStartupMessages({
  library(cfbfastR)
  library(dplyr)
  library(readr)
})
source("R/elo_engine.R")

# Set API key from environment (GitHub secret)
Sys.setenv(CFBD_API_KEY = Sys.getenv("CFBD_API_KEY"))

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
# CFB season starts Aug; if before Aug, current season hasn't started
if (as.integer(format(Sys.Date(), "%m")) < 8) CURRENT_YEAR <- CURRENT_YEAR - 1
SEASONS <- 2001:CURRENT_YEAR
OUT_DIR <- "CFB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Conference map (Power 5 + G5 majors) ─────────────────────
CONFS <- c(
  # ACC
  "Clemson"="ACC","Florida State"="ACC","Miami"="ACC","NC State"="ACC",
  "North Carolina"="ACC","Duke"="ACC","Virginia"="ACC","Virginia Tech"="ACC",
  "Georgia Tech"="ACC","Wake Forest"="ACC","Louisville"="ACC","Pittsburgh"="ACC",
  "Syracuse"="ACC","Notre Dame"="ACC","Boston College"="ACC","Stanford"="ACC",
  "SMU"="ACC","California"="ACC",
  # Big Ten
  "Michigan"="Big Ten","Ohio State"="Big Ten","Penn State"="Big Ten",
  "Michigan State"="Big Ten","Minnesota"="Big Ten","Wisconsin"="Big Ten",
  "Iowa"="Big Ten","Purdue"="Big Ten","Illinois"="Big Ten","Indiana"="Big Ten",
  "Rutgers"="Big Ten","Maryland"="Big Ten","Nebraska"="Big Ten",
  "Northwestern"="Big Ten","UCLA"="Big Ten","USC"="Big Ten",
  "Washington"="Big Ten","Oregon"="Big Ten",
  # Big 12
  "Texas"="Big 12","Oklahoma"="Big 12","Baylor"="Big 12","TCU"="Big 12",
  "Oklahoma State"="Big 12","Kansas State"="Big 12","Iowa State"="Big 12",
  "Texas Tech"="Big 12","Kansas"="Big 12","West Virginia"="Big 12",
  "BYU"="Big 12","Cincinnati"="Big 12","UCF"="Big 12","Houston"="Big 12",
  "Arizona"="Big 12","Arizona State"="Big 12","Colorado"="Big 12","Utah"="Big 12",
  # SEC
  "Alabama"="SEC","Georgia"="SEC","LSU"="SEC","Florida"="SEC",
  "Tennessee"="SEC","Auburn"="SEC","Ole Miss"="SEC",
  "Mississippi State"="SEC","Arkansas"="SEC","Kentucky"="SEC",
  "Missouri"="SEC","South Carolina"="SEC","Vanderbilt"="SEC",
  "Texas A&M"="SEC",
  # Mountain West
  "Boise State"="Mountain West","San Diego State"="Mountain West",
  "Fresno State"="Mountain West","Utah State"="Mountain West",
  "UNLV"="Mountain West","Wyoming"="Mountain West","Nevada"="Mountain West",
  "New Mexico"="Mountain West","Air Force"="Mountain West",
  "Colorado State"="Mountain West","San Jose State"="Mountain West",
  "Hawaii"="Mountain West",
  # AAC
  "Memphis"="AAC","Tulane"="AAC","SMU"="AAC","Navy"="AAC",
  "East Carolina"="AAC","South Florida"="AAC","Temple"="AAC",
  # Sun Belt
  "Louisiana"="Sun Belt","Appalachian State"="Sun Belt","Troy"="Sun Belt",
  "Georgia Southern"="Sun Belt","Arkansas State"="Sun Belt",
  "South Alabama"="Sun Belt","James Madison"="Sun Belt",
  "Marshall"="Sun Belt","Old Dominion"="Sun Belt","Georgia State"="Sun Belt",
  "UL Monroe"="Sun Belt","Southern Miss"="Sun Belt","Texas State"="Sun Belt"
)

# ── Helper: fetch one CFB season ─────────────────────────────
get_cfb_season <- function(yr) {
  tryCatch({
    reg <- cfbd_game_info(year = yr, season_type = "regular") %>%
      filter(!is.na(home_points), !is.na(away_points),
             home_points != away_points) %>%
      mutate(
        winner     = if_else(home_points > away_points, home_team, away_team),
        loser      = if_else(home_points > away_points, away_team, home_team),
        winner_pts = pmax(home_points, away_points),
        loser_pts  = pmin(home_points, away_points)
      ) %>%
      select(winner, loser, winner_pts, loser_pts)

    # Optionally include bowl games
    post <- tryCatch(
      cfbd_game_info(year = yr, season_type = "postseason") %>%
        filter(!is.na(home_points), !is.na(away_points),
               home_points != away_points) %>%
        mutate(
          winner     = if_else(home_points > away_points, home_team, away_team),
          loser      = if_else(home_points > away_points, away_team, home_team),
          winner_pts = pmax(home_points, away_points),
          loser_pts  = pmin(home_points, away_points)
        ) %>%
        select(winner, loser, winner_pts, loser_pts),
      error = function(e) NULL
    )
    bind_rows(reg, post)
  }, error = function(e) { message("  ERROR: ", e$message); NULL })
}

# ── Per-season Elo ────────────────────────────────────────────
for (yr in SEASONS) {
  message("CFB ", yr, "...")
  g <- get_cfb_season(yr)
  if (is.null(g) || nrow(g) < 50) { message("  Skipping"); next }

  elo <- run_elo(g, k = 30, iters = 10, min_games = 4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season = yr, conf_map = CONFS, sos_map = sos)

  # Extra CFB stat: resume_score (sum of beaten opponents' Elos)
  elo_lup <- setNames(elo$elo, elo$team)
  resume  <- tapply(seq_len(nrow(g)), g$winner, function(rows)
    sum(elo_lup[g$loser[rows]], na.rm = TRUE))
  out$resume_score <- round(resume[out$team], 1)

  write_csv(out, file.path(OUT_DIR, paste0("CFB_Elo_", yr, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("CFB done.")
