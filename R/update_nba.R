# ================================================================
# R/update_nba.R  —  NBA Elo, 2002–current
# Data: ESPN scoreboard API (dates=YYYYMMDD)
#
# FIXES:
#  1. Filter out All-Star / special event teams by checking against
#     an allowlist of the 30 real NBA franchises (all name variants)
#  2. Comprehensive alias map covering all historical team names
#     (SuperSonics, NJ Nets, New Jersey Nets, Charlotte Bobcats, etc.)
#  3. Season = spring year (2025-26 = 2026). Detected live from ESPN.
# ================================================================
suppressPackageStartupMessages({
  library(dplyr); library(readr); library(httr); library(jsonlite)
})
source("R/elo_engine.R")

OUT_DIR <- "docs/NBA/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Allowlist of real NBA team display names (all eras) ──────
# Any team name NOT in this set is filtered out (All-Star teams, etc.)
NBA_TEAMS <- c(
  # Atlanta
  "Atlanta Hawks",
  # Boston
  "Boston Celtics",
  # Brooklyn / New Jersey
  "Brooklyn Nets","New Jersey Nets",
  # Charlotte
  "Charlotte Hornets","Charlotte Bobcats",
  # Chicago
  "Chicago Bulls",
  # Cleveland
  "Cleveland Cavaliers",
  # Dallas
  "Dallas Mavericks",
  # Denver
  "Denver Nuggets",
  # Detroit
  "Detroit Pistons",
  # Golden State
  "Golden State Warriors",
  # Houston
  "Houston Rockets",
  # Indiana
  "Indiana Pacers",
  # LA Clippers
  "LA Clippers","Los Angeles Clippers",
  # LA Lakers
  "Los Angeles Lakers",
  # Memphis
  "Memphis Grizzlies",
  # Miami
  "Miami Heat",
  # Milwaukee
  "Milwaukee Bucks",
  # Minnesota
  "Minnesota Timberwolves",
  # New Orleans
  "New Orleans Pelicans","New Orleans Hornets","New Orleans/Oklahoma City Hornets",
  # New York
  "New York Knicks",
  # Oklahoma City
  "Oklahoma City Thunder","Seattle SuperSonics","Seattle Supersonics",
  # Orlando
  "Orlando Magic",
  # Philadelphia
  "Philadelphia 76ers",
  # Phoenix
  "Phoenix Suns",
  # Portland
  "Portland Trail Blazers",
  # Sacramento
  "Sacramento Kings",
  # San Antonio
  "San Antonio Spurs",
  # Toronto
  "Toronto Raptors",
  # Utah
  "Utah Jazz",
  # Washington
  "Washington Wizards","Washington Bullets"
)
NBA_SET <- toupper(NBA_TEAMS)

# ── Division map (current + historical) ──────────────────────
DIVS <- c(
  # Atlantic
  "Boston Celtics"="Atlantic","Brooklyn Nets"="Atlantic",
  "New Jersey Nets"="Atlantic","New York Knicks"="Atlantic",
  "Philadelphia 76ers"="Atlantic","Toronto Raptors"="Atlantic",
  # Central
  "Chicago Bulls"="Central","Cleveland Cavaliers"="Central",
  "Detroit Pistons"="Central","Indiana Pacers"="Central",
  "Milwaukee Bucks"="Central",
  # Southeast
  "Atlanta Hawks"="Southeast","Charlotte Hornets"="Southeast",
  "Charlotte Bobcats"="Southeast","Miami Heat"="Southeast",
  "Orlando Magic"="Southeast","Washington Wizards"="Southeast",
  "Washington Bullets"="Southeast",
  # Northwest
  "Denver Nuggets"="Northwest","Minnesota Timberwolves"="Northwest",
  "Oklahoma City Thunder"="Northwest","Portland Trail Blazers"="Northwest",
  "Utah Jazz"="Northwest","Seattle SuperSonics"="Northwest",
  "Seattle Supersonics"="Northwest",
  # Pacific
  "Golden State Warriors"="Pacific","LA Clippers"="Pacific",
  "Los Angeles Clippers"="Pacific","Los Angeles Lakers"="Pacific",
  "Phoenix Suns"="Pacific","Sacramento Kings"="Pacific",
  # Southwest
  "Dallas Mavericks"="Southwest","Houston Rockets"="Southwest",
  "Memphis Grizzlies"="Southwest","New Orleans Pelicans"="Southwest",
  "New Orleans Hornets"="Southwest",
  "New Orleans/Oklahoma City Hornets"="Southwest",
  "San Antonio Spurs"="Southwest"
)

# ── Detect current season year from ESPN ──────────────────────
get_current_nba_season <- function() {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
        timeout(15)), error=function(e) NULL)
  if (is.null(resp) || status_code(resp) != 200) return(2026L)
  data <- tryCatch(fromJSON(rawToChar(resp$content), simplifyDataFrame=FALSE),
                   error=function(e) NULL)
  yr <- tryCatch(as.integer(data$leagues[[1]]$season$year), error=function(e) 2026L)
  if (is.na(yr) || yr < 2002) 2026L else yr
}

# ── Parse one event — filter non-real teams ───────────────────
parse_event <- function(ev) {
  tryCatch({
    comp <- ev$competitions[[1]]
    if (!isTRUE(comp$status$type$completed)) return(NULL)
    comps <- comp$competitors
    if (length(comps) != 2) return(NULL)
    hi  <- which(sapply(comps, `[[`, "homeAway") == "home")
    ai  <- which(sapply(comps, `[[`, "homeAway") == "away")
    if (!length(hi)||!length(ai)) return(NULL)
    hs  <- suppressWarnings(as.numeric(comps[[hi]]$score))
    as_ <- suppressWarnings(as.numeric(comps[[ai]]$score))
    hn  <- comps[[hi]]$team$displayName
    an  <- comps[[ai]]$team$displayName
    if (is.na(hs)||is.na(as_)||is.null(hn)||is.null(an)||hs==as_||hs<70) return(NULL)
    # Filter out All-Star / special teams
    if (!toupper(hn) %in% NBA_SET || !toupper(an) %in% NBA_SET) return(NULL)
    list(winner=if(hs>as_)hn else an, loser=if(hs>as_)an else hn,
         winner_pts=max(hs,as_), loser_pts=min(hs,as_))
  }, error=function(e) NULL)
}

fetch_day <- function(ds) {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
        query=list(dates=ds, limit=20), timeout(20)), error=function(e) NULL)
  if (is.null(resp)||status_code(resp)!=200) return(NULL)
  data <- tryCatch(fromJSON(rawToChar(resp$content),simplifyDataFrame=FALSE),
                   error=function(e) NULL)
  if (is.null(data)||length(data$events)==0) return(NULL)
  rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
  if (!length(rows)) return(NULL)
  data.frame(winner=sapply(rows,`[[`,"winner"),loser=sapply(rows,`[[`,"loser"),
             winner_pts=as.numeric(sapply(rows,`[[`,"winner_pts")),
             loser_pts=as.numeric(sapply(rows,`[[`,"loser_pts")),
             stringsAsFactors=FALSE)
}

fetch_nba_season <- function(s) {
  start_yr  <- s - 1
  seas_start <- as.Date(paste0(start_yr, "-10-01"))
  seas_end   <- min(as.Date(paste0(s, "-06-30")), Sys.Date())
  message("  ESPN API: NBA ", start_yr, "-", s)
  if (seas_start > seas_end) {
    message("  Season hasn't started yet — skipping")
    return(NULL)
  }
  dates <- seq(seas_start, seas_end, by="1 day")
  all_games <- list()
  for (d in as.character(dates)) {
    res <- fetch_day(gsub("-","",d))
    if (!is.null(res)&&nrow(res)>0) all_games <- c(all_games, list(res))
    Sys.sleep(0.1)
  }
  if (!length(all_games)) return(NULL)
  games <- do.call(rbind, all_games)
  unique(games[!is.na(games$winner)&games$winner!=""&games$winner!=games$loser,])
}

CURRENT_SEASON <- get_current_nba_season()
message("Current NBA season: ", CURRENT_SEASON)
# Only update current season — historical CSVs are already correct
# NBA already detects CURRENT_SEASON via get_current_nba_season()
# SEASONS is a single value — just the current season
NEXT_SEASON <- CURRENT_SEASON + 1L
SEASONS <- c(CURRENT_SEASON, NEXT_SEASON)
message("NBA: updating seasons ", paste(SEASONS, collapse=", "))

for (s in SEASONS) {
  message("NBA ", s, "...")
  g <- fetch_nba_season(s)
  if (is.null(g)||nrow(g)<50) { message("  Skip — ",if(is.null(g))0 else nrow(g)," games"); next }
  message("  ", nrow(g), " games")
  elo <- run_elo(g, k=25, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season=s, conf_map=DIVS, sos_map=sos)
  write_csv(out, file.path(OUT_DIR, paste0("NBA_Elo_", s, ".csv")))
  message("  -> ", nrow(out), " teams | NA conf: ", sum(is.na(out$conference)))
}
