# ================================================================
# R/update_nba.R  —  NBA Elo, 2002-current
# Data: ESPN public scoreboard API (same approach as NHL/CFB)
# Endpoint: site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
# Key fields: competitors[].team.displayName, score, homeAway,
#             status.type.completed
#
# NOTE on season numbering: ESPN uses the SPRING year.
# 2025-26 season = season 2026 (hoopR returns 2025 — WRONG for current)
# We detect current season by querying today's date from ESPN directly.
# ================================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(readr)
  library(httr)
  library(jsonlite)
})
source("R/elo_engine.R")

OUT_DIR <- "docs/NBA/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Division map (full display names from ESPN) ───────────────
DIVS <- c(
  "Boston Celtics"="Atlantic",      "Brooklyn Nets"="Atlantic",
  "New York Knicks"="Atlantic",     "Philadelphia 76ers"="Atlantic",
  "Toronto Raptors"="Atlantic",
  "Chicago Bulls"="Central",        "Cleveland Cavaliers"="Central",
  "Detroit Pistons"="Central",      "Indiana Pacers"="Central",
  "Milwaukee Bucks"="Central",
  "Atlanta Hawks"="Southeast",      "Charlotte Hornets"="Southeast",
  "Miami Heat"="Southeast",         "Orlando Magic"="Southeast",
  "Washington Wizards"="Southeast",
  "Denver Nuggets"="Northwest",     "Minnesota Timberwolves"="Northwest",
  "Oklahoma City Thunder"="Northwest","Portland Trail Blazers"="Northwest",
  "Utah Jazz"="Northwest",
  "Golden State Warriors"="Pacific","LA Clippers"="Pacific",
  "Los Angeles Lakers"="Pacific",   "Phoenix Suns"="Pacific",
  "Sacramento Kings"="Pacific",
  "Dallas Mavericks"="Southwest",   "Houston Rockets"="Southwest",
  "Memphis Grizzlies"="Southwest",  "New Orleans Pelicans"="Southwest",
  "San Antonio Spurs"="Southwest"
)

# ── Detect current NBA season from ESPN ───────────────────────
get_current_nba_season <- function() {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
        timeout(15)),
    error = function(e) NULL
  )
  if (is.null(resp) || status_code(resp) != 200) return(2026L)
  data <- tryCatch(fromJSON(rawToChar(resp$content), simplifyDataFrame = FALSE),
                   error = function(e) NULL)
  yr <- tryCatch(as.integer(data$leagues[[1]]$season$year), error = function(e) 2026L)
  if (is.na(yr) || yr < 2002) 2026L else yr
}

# ── Parse one event ───────────────────────────────────────────
parse_event <- function(ev) {
  tryCatch({
    comp <- ev$competitions[[1]]
    if (!isTRUE(comp$status$type$completed)) return(NULL)
    comps <- comp$competitors
    if (length(comps) != 2) return(NULL)
    hi  <- which(sapply(comps, `[[`, "homeAway") == "home")
    ai  <- which(sapply(comps, `[[`, "homeAway") == "away")
    if (!length(hi) || !length(ai)) return(NULL)
    hs  <- suppressWarnings(as.numeric(comps[[hi]]$score))
    as_ <- suppressWarnings(as.numeric(comps[[ai]]$score))
    hn  <- comps[[hi]]$team$displayName
    an  <- comps[[ai]]$team$displayName
    if (is.na(hs)||is.na(as_)||is.null(hn)||is.null(an)||hs==as_||hs==0) return(NULL)
    list(winner=if(hs>as_)hn else an, loser=if(hs>as_)an else hn,
         winner_pts=max(hs,as_), loser_pts=min(hs,as_))
  }, error=function(e) NULL)
}

# ── Fetch one day ─────────────────────────────────────────────
fetch_day <- function(date_str) {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
        query=list(dates=date_str, limit=20),
        timeout(20)),
    error=function(e) NULL
  )
  if (is.null(resp) || status_code(resp) != 200) return(NULL)
  data <- tryCatch(fromJSON(rawToChar(resp$content), simplifyDataFrame=FALSE),
                   error=function(e) NULL)
  if (is.null(data) || length(data$events)==0) return(NULL)
  rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
  if (!length(rows)) return(NULL)
  data.frame(
    winner=sapply(rows,`[[`,"winner"), loser=sapply(rows,`[[`,"loser"),
    winner_pts=as.numeric(sapply(rows,`[[`,"winner_pts")),
    loser_pts=as.numeric(sapply(rows,`[[`,"loser_pts")),
    stringsAsFactors=FALSE
  )
}

# ── Fetch full NBA season ─────────────────────────────────────
# NBA season: October (year-1) through June (year)
# e.g. season 2026 = Oct 2025 through Jun 2026
fetch_nba_season <- function(season_yr) {
  start_yr <- season_yr - 1
  message("  ESPN API: NBA ", start_yr, "-", season_yr)
  dates <- seq(as.Date(paste0(start_yr, "-10-01")),
               min(as.Date(paste0(season_yr, "-06-30")), Sys.Date()),
               by = "1 day")
  all_games <- list()
  for (d in as.character(dates)) {
    res <- fetch_day(gsub("-","",d))
    if (!is.null(res) && nrow(res) > 0) all_games <- c(all_games, list(res))
    Sys.sleep(0.1)
  }
  if (!length(all_games)) return(NULL)
  games <- do.call(rbind, all_games)
  games <- games[!is.na(games$winner) & games$winner != "" &
                 games$winner != games$loser, ]
  unique(games)
}

# ── Determine season range ────────────────────────────────────
CURRENT_SEASON <- get_current_nba_season()
message("Current NBA season (ESPN): ", CURRENT_SEASON)
SEASONS <- 2002:CURRENT_SEASON

# ── Per-season Elo ─────────────────────────────────────────────
for (s in SEASONS) {
  message("NBA ", s, "...")
  g <- fetch_nba_season(s)
  if (is.null(g) || nrow(g) < 50) {
    message("  Skipping — ", if(is.null(g)) 0 else nrow(g), " games")
    next
  }
  message("  ", nrow(g), " games")
  elo <- run_elo(g, k=25, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season=s, conf_map=DIVS, sos_map=sos)
  write_csv(out, file.path(OUT_DIR, paste0("NBA_Elo_", s, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("NBA done.")
