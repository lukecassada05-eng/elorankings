# ================================================================
# R/update_mlb.R
# MLB Elo by season, 2001-current
# Package : baseballr
# Key fn  : mlb_schedule(season)
# Verified cols (from YOUR working code):
#   game_type, teams_home_score, teams_away_score,
#   teams_home_team_name, teams_away_team_name
# ================================================================

suppressPackageStartupMessages({
  library(baseballr)
  library(dplyr)
  library(readr)
})
source("R/elo_engine.R")

# Only update current season — historical CSVs are already correct  
CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
CURRENT_MONTH <- as.integer(format(Sys.Date(), "%m"))
# MLB season runs Mar-Oct; if before Mar we're still in prior year
CURRENT_SEASON <- if (CURRENT_MONTH < 3) CURRENT_YEAR - 1L else CURRENT_YEAR
NEXT_SEASON <- CURRENT_SEASON + 1L
# Only update current season — historical CSVs don't change
SEASONS <- c(CURRENT_SEASON, NEXT_SEASON)
message("MLB: updating seasons ", CURRENT_SEASON, ", ", NEXT_SEASON)
OUT_DIR <- "docs/MLB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Division map ──────────────────────────────────────────────
DIVS <- c(
  "New York Yankees"="AL East",    "Boston Red Sox"="AL East",
  "Toronto Blue Jays"="AL East",   "Tampa Bay Rays"="AL East",    "Tampa Bay Devil Rays"="AL East",
  "Baltimore Orioles"="AL East",
  "Chicago White Sox"="AL Central","Cleveland Guardians"="AL Central",
  "Cleveland Indians"="AL Central","Detroit Tigers"="AL Central",
  "Kansas City Royals"="AL Central","Minnesota Twins"="AL Central",
  "Houston Astros"="AL West",      "Los Angeles Angels"="AL West",
  "Oakland Athletics"="AL West",   "Athletics"="AL West",
  "Sacramento Athletics"="AL West", "Seattle Mariners"="AL West",
  "Texas Rangers"="AL West",       "Anaheim Angels"="AL West",   "Los Angeles Angels of Anaheim"="AL West",
  "Atlanta Braves"="NL East",      "Miami Marlins"="NL East",
  "Florida Marlins"="NL East",     "New York Mets"="NL East",
  "Philadelphia Phillies"="NL East","Washington Nationals"="NL East",
  "Montreal Expos"="NL East",
  "Chicago Cubs"="NL Central",     "Cincinnati Reds"="NL Central",
  "Milwaukee Brewers"="NL Central","Pittsburgh Pirates"="NL Central",
  "St. Louis Cardinals"="NL Central",
  "Arizona Diamondbacks"="NL West","Colorado Rockies"="NL West",
  "Los Angeles Dodgers"="NL West", "San Diego Padres"="NL West",
  "San Francisco Giants"="NL West"
)

# ── Helper: fetch one season (exact column names from your code) ──
get_mlb_season <- function(yr) {
  # Don't attempt future seasons — baseballr throws errors
  if (yr > as.integer(format(Sys.Date(), "%Y"))) {
    message("  Skipping ", yr, " — season hasn't started yet")
    return(NULL)
  }
  message("  Fetching MLB ", yr, "...")
  tryCatch({
    mlb_schedule(season = yr) %>%
      filter(
        game_type == "R",
        !is.na(teams_home_score),
        !is.na(teams_away_score),
        teams_home_score != teams_away_score
      ) %>%
      mutate(
        winner     = if_else(teams_home_score > teams_away_score,
                             teams_home_team_name, teams_away_team_name),
        loser      = if_else(teams_home_score > teams_away_score,
                             teams_away_team_name, teams_home_team_name),
        winner_pts = pmax(teams_home_score, teams_away_score),
        loser_pts  = pmin(teams_home_score, teams_away_score)
      ) %>%
      filter(!is.na(winner), !is.na(loser), winner != loser) %>%
      select(winner, loser, winner_pts, loser_pts) |>
      # Normalize franchise name changes for consistency
      mutate(
        winner = case_when(
          winner == "Oakland Athletics" ~ "Athletics",
          TRUE ~ winner
        ),
        loser = case_when(
          loser == "Oakland Athletics" ~ "Athletics",
          TRUE ~ loser
        )
      )
  }, error = function(e) { message("  ERROR: ", e$message); NULL })
}

# ── Per-season Elo ────────────────────────────────────────────
for (yr in SEASONS) {
  g <- get_mlb_season(yr)
  if (is.null(g) || nrow(g) < 50) { message("  Skipping ", yr); next }

  # Cap run margin at 10 (baseball blowouts shouldn't inflate Elo too much)
  g <- mutate(g, winner_pts = pmin(winner_pts, loser_pts + 10))

  elo <- run_elo(g, k = 20, iters = 10, min_games = 4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season = yr, conf_map = DIVS, sos_map = sos)

  write_csv(out, file.path(OUT_DIR, paste0("MLB_Elo_", yr, ".csv")))
  message("  -> ", nrow(out), " teams")
}
