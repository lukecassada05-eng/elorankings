# ================================================================
# R/update_soccer.R
# European Football Elo by season, 2002-current
# Data  : football-data.co.uk free CSVs (same source as YOUR code)
# Verified cols: HomeTeam, AwayTeam, FTHG (home goals), FTAG (away goals)
# ================================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(readr)
})
source("R/elo_engine.R")

OUT_DIR <- "docs/Soccer/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# Season end-years to process (2002 = 2001-02 season)
cur_month <- as.integer(format(Sys.Date(), "%m"))
cur_year  <- as.integer(format(Sys.Date(), "%Y"))
# Season ends May/June; if Aug+ current season has started so end_year = next year
LAST_END  <- if (cur_month >= 8) cur_year + 1 else cur_year
# Only update current season — historical CSVs are already correct
# Include next season so it auto-populates when football-data.co.uk has data
END_YEARS <- c(LAST_END, LAST_END + 1L)
message("Soccer: updating seasons ending ", paste(END_YEARS, collapse=", "))

# ── League definitions (EXACT same as your working code) ─────
# code = football-data.co.uk file code
LEAGUES <- list(
  list(code="E0",  name="Premier League",       country="ENG"),
  list(code="E1",  name="Championship",          country="ENG"),
  list(code="SC0", name="Scottish Premiership",  country="SCO"),
  list(code="D0",  name="Bundesliga",            country="GER"),
  list(code="D1",  name="2. Bundesliga",         country="GER"),
  list(code="I1",  name="Serie A",               country="ITA"),
  list(code="I2",  name="Serie B",               country="ITA"),
  list(code="SP1", name="La Liga",               country="ESP"),
  list(code="SP2", name="La Liga 2",             country="ESP"),
  list(code="F1",  name="Ligue 1",               country="FRA"),
  list(code="F2",  name="Ligue 2",               country="FRA"),
  list(code="NL",  name="Eredivisie",            country="NED"),
  list(code="P1",  name="Primeira Liga",         country="POR"),
  list(code="B1",  name="Pro League",            country="BEL"),
  list(code="T1",  name="Süper Lig",             country="TUR")
)

# ── Season-code builder (e.g. end_year=2025 → "2425") ────────
season_code <- function(ey) paste0(substr(ey-1,3,4), substr(ey,3,4))

# ── Fetch one league CSV (same logic as YOUR working code) ────
fetch_league <- function(ey, lg) {
  url <- paste0("https://www.football-data.co.uk/mmz4281/",
                season_code(ey), "/", lg$code, ".csv")
  tryCatch({
    df <- read_csv(url, show_col_types = FALSE, progress = FALSE)
    needed <- c("HomeTeam","AwayTeam","FTHG","FTAG")
    if (!all(needed %in% names(df))) return(NULL)
    df %>%
      filter(!is.na(FTHG), !is.na(FTAG)) %>%
      transmute(
        home       = trimws(HomeTeam),
        away       = trimws(AwayTeam),
        home_score = as.integer(FTHG),
        away_score = as.integer(FTAG),
        league     = lg$name,
        country    = lg$country
      )
  }, error = function(e) NULL)
}

# ── Per-season Elo ────────────────────────────────────────────
for (ey in END_YEARS) {
  message("Soccer ", ey-1, "-", ey, "...")

  all_matches <- bind_rows(lapply(LEAGUES, function(lg) fetch_league(ey, lg)))
  if (nrow(all_matches) < 100) { message("  Skipping"); next }

  # Count draws (for record display, not used in Elo)
  draws_tbl <- all_matches %>%
    filter(home_score == away_score) %>%
    { bind_rows(
        transmute(., team=home, draws=1),
        transmute(., team=away, draws=1)
      ) } %>%
    group_by(team) %>%
    summarise(draws = n(), .groups="drop")

  # Decisive games for Elo (same as your code: skip draws)
  decisive <- all_matches %>%
    filter(home_score != away_score) %>%
    mutate(
      winner     = if_else(home_score > away_score, home, away),
      loser      = if_else(home_score < away_score, home, away),
      winner_pts = pmax(home_score, away_score),
      loser_pts  = pmin(home_score, away_score)
    ) %>%
    select(winner, loser, winner_pts, loser_pts, league, country)

  g_core <- select(decisive, winner, loser, winner_pts, loser_pts)

  # League lookup per team
  lg_lup <- bind_rows(
    transmute(decisive, team=winner, league, country),
    transmute(decisive, team=loser,  league, country)
  ) %>% distinct(team, .keep_all=TRUE)
  conf_map <- setNames(lg_lup$league, lg_lup$team)

  elo <- run_elo(g_core, k=30, iters=10, min_games=3)
  elo <- attach_best_wins(elo, g_core)
  sos <- compute_sos(g_core, elo)
  out <- build_output(elo, season=ey, conf_map=conf_map, sos_map=sos)

  # Add draws + country
  out <- out %>%
    left_join(draws_tbl, by="team") %>%
    mutate(draws = replace(draws, is.na(draws), 0L)) %>%
    left_join(select(lg_lup, team, country), by="team")

  write_csv(out, file.path(OUT_DIR, paste0("Soccer_Elo_", ey, ".csv")))
  message("  -> ", nrow(out), " clubs")
}
message("Soccer done.")

# ── MLS (ESPN API — football-data.co.uk doesn't cover MLS) ───────────
message("Soccer: fetching MLS from ESPN API")

fetch_mls_espn <- function(yr) {
  base_url <- paste0(
    "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard",
    "?limit=500&seasontype=2"
  )
  tryCatch({
    res <- httr::GET(base_url, httr::timeout(15))
    if (httr::status_code(res) != 200) return(NULL)
    data <- jsonlite::fromJSON(httr::content(res, "text", encoding="UTF-8"),
                               simplifyVector=FALSE)
    events <- data$events
    if (!length(events)) return(NULL)
    
    rows <- lapply(events, function(ev) {
      comp <- ev$competitions[[1]]
      comps <- comp$competitors
      if (length(comps) < 2) return(NULL)
      
      home_idx <- which(sapply(comps, function(c) c$homeAway == "home"))
      away_idx <- which(sapply(comps, function(c) c$homeAway == "away"))
      if (!length(home_idx) || !length(away_idx)) return(NULL)
      
      home <- comps[[home_idx[1]]]
      away <- comps[[away_idx[1]]]
      
      completed <- isTRUE(comp$status$type$completed)
      if (!completed) return(NULL)
      
      hs <- suppressWarnings(as.integer(home$score))
      as_ <- suppressWarnings(as.integer(away$score))
      if (is.na(hs) || is.na(as_)) return(NULL)
      
      data.frame(
        home_team = home$team$displayName,
        away_team = away$team$displayName,
        home_goals = hs,
        away_goals = as_,
        date = substr(ev$date, 1, 10),
        league = "MLS",
        country = "USA",
        stringsAsFactors = FALSE
      )
    })
    do.call(rbind, Filter(Negate(is.null), rows))
  }, error = function(e) { message("MLS ESPN error: ", e$message); NULL })
}

mls_games <- fetch_mls_espn(LAST_END)
if (!is.null(mls_games) && nrow(mls_games) > 0) {
  message("  MLS: ", nrow(mls_games), " completed games found")
  # Add to existing soccer CSV for current season
  out_file <- file.path(OUT_DIR, paste0("Soccer_Elo_", LAST_END, ".csv"))
  if (file.exists(out_file)) {
    existing <- readr::read_csv(out_file, show_col_types = FALSE)
    # Only process if MLS teams not already in the file
    if (!any(grepl("Galaxy|Inter Miami|LAFC|Sounders", existing$team))) {
      # Run Elo engine on MLS games
      mls_elo <- run_elo(mls_games %>%
        rename(home=home_team, away=away_team, hg=home_goals, ag=away_goals) %>%
        mutate(league="MLS", country="USA"),
        k=30, hca=65, init=1500)
      mls_out <- mls_elo %>% mutate(conference="MLS", updated_at=format(Sys.time(), "%Y-%m-%d"))
      combined <- dplyr::bind_rows(existing, mls_out)
      readr::write_csv(combined, out_file)
      message("  MLS Elo added to Soccer_Elo_", LAST_END, ".csv")
    }
  }
}
