# ================================================================
# R/update_nhl.R  —  NHL Elo, 2012-current
# Package: fastRhockey  |  Function: load_nhl_schedule(seasons)
# FIX: was filtering game_type == "R" but fastRhockey uses
#      numeric game_type (2 = regular season).
#      Also added diagnostic message to see actual column names.
# ================================================================

suppressPackageStartupMessages({
  library(fastRhockey)
  library(dplyr)
  library(readr)
})
source("R/elo_engine.R")

CURRENT_SEASON <- most_recent_nhl_season()
SEASONS        <- 2012:CURRENT_SEASON
OUT_DIR        <- "NHL/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

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

get_nhl_season <- function(s) {
  tryCatch({
    sched <- load_nhl_schedule(seasons = s)
    message("  Cols: ", paste(head(names(sched), 20), collapse=", "))
    message("  Rows: ", nrow(sched))

    # Detect correct score and team columns
    # fastRhockey schedule has: home_score, away_score, home_team, away_team
    # and game_type which may be character ("R","P") or integer (2,3)
    score_cols <- names(sched)[grepl("score", names(sched), ignore.case=TRUE)]
    message("  Score cols: ", paste(score_cols, collapse=", "))

    # Normalise game_type
    sched <- sched %>%
      mutate(game_type_norm = as.character(game_type))

    # Regular season = type "R" (character) or "2" (if numeric)
    reg <- sched %>%
      filter(game_type_norm %in% c("R","2","REG","Regular Season") |
               grepl("regular", tolower(game_type_norm)))

    if (nrow(reg) == 0) {
      message("  game_type values: ", paste(unique(sched$game_type_norm)[1:10], collapse=", "))
      # Fall back: use all games with valid non-zero scores
      reg <- sched
    }

    reg <- reg %>%
      filter(!is.na(home_score), !is.na(away_score),
             as.integer(home_score) > 0 | as.integer(away_score) > 0,
             as.integer(home_score) != as.integer(away_score)) %>%
      mutate(
        hs  = as.integer(home_score),
        as_ = as.integer(away_score),
        winner     = if_else(hs > as_, home_team, away_team),
        loser      = if_else(hs < as_, home_team, away_team),
        winner_pts = pmin(pmax(hs, as_), pmin(hs, as_) + 4L),  # cap margin at 4
        loser_pts  = pmin(hs, as_)
      ) %>%
      filter(!is.na(winner), winner != "", winner != loser)

    if (nrow(reg) == 0) return(NULL)
    select(reg, winner, loser, winner_pts, loser_pts)
  }, error = function(e) { message("  ERROR: ", e$message); NULL })
}

for (s in SEASONS) {
  message("NHL ", s, "...")
  g <- get_nhl_season(s)
  if (is.null(g) || nrow(g) < 50) {
    message("  Skipping — ", if(is.null(g)) 0 else nrow(g), " games")
    next
  }
  message("  ", nrow(g), " games")
  elo <- run_elo(g, k=25, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season=s, conf_map=DIVS, sos_map=sos)
  write_csv(out, file.path(OUT_DIR, paste0("NHL_Elo_", s, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("NHL done.")
