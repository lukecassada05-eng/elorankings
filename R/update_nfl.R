# ================================================================
# R/update_nfl.R
# NFL Elo by season, 2001-current
# Package : nflreadr
# Key fn  : load_schedules(seasons)
# Verified cols used:
#   season, game_type, home_team, away_team,
#   home_score, away_score, location
# ================================================================

suppressPackageStartupMessages({
  library(nflreadr)
  library(dplyr)
  library(readr)
})
source("R/elo_engine.R")

SEASONS <- 2001:as.integer(format(Sys.Date(), "%Y"))
OUT_DIR <- "docs/NFL/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Division lookup ───────────────────────────────────────────
DIVS <- c(
  # AFC East
  BUF="AFC East", MIA="AFC East", NE="AFC East", NYJ="AFC East",
  # AFC North
  BAL="AFC North", CIN="AFC North", CLE="AFC North", PIT="AFC North",
  # AFC South (HOU expansion 2002; TEN was OIL/Oilers pre-1999)
  HOU="AFC South", IND="AFC South", JAX="AFC South", JAC="AFC South", TEN="AFC South",
  # AFC West (OAK→LV 2020; SD→LAC 2017)
  DEN="AFC West", KC="AFC West", LV="AFC West", OAK="AFC West",
  LAC="AFC West", SD="AFC West",
  # NFC East (WAS sometimes WSH)
  DAL="NFC East", NYG="NFC East", PHI="NFC East", WAS="NFC East", WSH="NFC East",
  # NFC North
  CHI="NFC North", DET="NFC North", GB="NFC North", MIN="NFC North",
  # NFC South
  ATL="NFC South", CAR="NFC South", NO="NFC South", TB="NFC South",
  # NFC West (STL→LAR 2016)
  ARI="NFC West", LAR="NFC West", STL="NFC West", SF="NFC West", SEA="NFC West"
)

# ── Load all seasons ──────────────────────────────────────────
message("Loading NFL schedules 2001-", max(SEASONS), "...")
all_games <- load_schedules(seasons = SEASONS) %>%
  filter(
    game_type == "REG",        # regular season only
    !is.na(home_score),
    !is.na(away_score),
    home_score != away_score   # skip ties
  ) %>%
  mutate(
    season     = as.integer(season),
    winner     = if_else(home_score > away_score, home_team, away_team),
    loser      = if_else(home_score > away_score, away_team, home_team),
    winner_pts = pmax(home_score, away_score),
    loser_pts  = pmin(home_score, away_score)
  ) %>%
  select(season, winner, loser, winner_pts, loser_pts)

# ── Per-season Elo ────────────────────────────────────────────
for (s in sort(unique(all_games$season))) {
  message("NFL ", s, "...")
  g <- filter(all_games, season == s)
  if (nrow(g) < 10) next

  elo <- run_elo(g, k = 30, iters = 10, min_games = 4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season = s, conf_map = DIVS, sos_map = sos)

  write_csv(out, file.path(OUT_DIR, paste0("NFL_Elo_", s, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("NFL done.")
