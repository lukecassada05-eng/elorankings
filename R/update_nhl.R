# ================================================================
# R/update_nhl.R
# NHL Elo by season, 2011-current
# Package : fastRhockey
# Key fn  : load_nhl_schedule(seasons)
# Verified cols (from official CRAN PDF, confirmed in walkthrough):
#   home_score, away_score, home_team, away_team, game_type
#   (game_type: "R"=regular, "P"=playoff, "PR"=preseason)
# Note: fastRhockey data goes back to 2011 (Min: 2011)
# ================================================================

suppressPackageStartupMessages({
  library(fastRhockey)
  library(dplyr)
  library(readr)
})
source("R/elo_engine.R")

CURRENT_SEASON <- most_recent_nhl_season()
# NHL season straddles two years; season year = spring year
# e.g. 2024-25 season = season 2025
SEASONS <- 2012:CURRENT_SEASON   # fastRhockey data starts 2011; use 2012 for completeness
OUT_DIR <- "NHL/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Division map (current; teams moved divisions over years) ──
DIVS <- c(
  "Boston Bruins"="Atlantic",       "Buffalo Sabres"="Atlantic",
  "Detroit Red Wings"="Atlantic",   "Florida Panthers"="Atlantic",
  "Montreal Canadiens"="Atlantic",  "Ottawa Senators"="Atlantic",
  "Tampa Bay Lightning"="Atlantic", "Toronto Maple Leafs"="Atlantic",
  "Carolina Hurricanes"="Metropolitan","Columbus Blue Jackets"="Metropolitan",
  "New Jersey Devils"="Metropolitan","New York Islanders"="Metropolitan",
  "New York Rangers"="Metropolitan","Philadelphia Flyers"="Metropolitan",
  "Pittsburgh Penguins"="Metropolitan","Washington Capitals"="Metropolitan",
  "Arizona Coyotes"="Central",      "Utah Hockey Club"="Central",
  "Chicago Blackhawks"="Central",   "Colorado Avalanche"="Central",
  "Dallas Stars"="Central",         "Minnesota Wild"="Central",
  "Nashville Predators"="Central",  "St. Louis Blues"="Central",
  "Winnipeg Jets"="Central",
  "Anaheim Ducks"="Pacific",        "Calgary Flames"="Pacific",
  "Edmonton Oilers"="Pacific",      "Los Angeles Kings"="Pacific",
  "San Jose Sharks"="Pacific",      "Seattle Kraken"="Pacific",
  "Vancouver Canucks"="Pacific",    "Vegas Golden Knights"="Pacific"
)

# ── Helper: fetch one NHL season ─────────────────────────────
get_nhl_season <- function(s) {
  tryCatch({
    sched <- load_nhl_schedule(seasons = s)

    # Filter regular season completed games
    # game_type column: "R" = regular season
    sched %>%
      filter(
        game_type == "R",
        !is.na(home_score),
        !is.na(away_score),
        as.integer(home_score) != as.integer(away_score)
      ) %>%
      mutate(
        hs = as.integer(home_score),
        as_ = as.integer(away_score),
        winner     = if_else(hs > as_, home_team, away_team),
        loser      = if_else(hs < as_, home_team, away_team),
        winner_pts = pmax(hs, as_),
        loser_pts  = pmin(hs, as_)
      ) %>%
      filter(!is.na(winner), !is.na(loser), winner != loser) %>%
      select(winner, loser, winner_pts, loser_pts)
  }, error = function(e) { message("  ERROR: ", e$message); NULL })
}

# ── Per-season Elo ────────────────────────────────────────────
for (s in SEASONS) {
  message("NHL ", s, "...")
  g <- get_nhl_season(s)
  if (is.null(g) || nrow(g) < 50) { message("  Skipping"); next }

  # Hockey goals: cap margin at 4 (softer margin effect)
  g <- mutate(g, winner_pts = pmin(winner_pts, loser_pts + 4))

  elo <- run_elo(g, k = 25, iters = 10, min_games = 4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season = s, conf_map = DIVS, sos_map = sos)

  write_csv(out, file.path(OUT_DIR, paste0("NHL_Elo_", s, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("NHL done.")
