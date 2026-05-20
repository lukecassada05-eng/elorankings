# ================================================================
# R/update_nhl.R  —  NHL Elo, 2012-current
# Data: ESPN public scoreboard API (NO KEY — same approach as CFB)
# NOTE: fastRhockey's load_nhl_schedule hits the old NHL Stats API
#       (statsapi.web.nhl.com) which was deprecated in 2023 and
#       now returns empty data. ESPN is more reliable.
# Endpoint: site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard
# Key fields: competitors[].team.shortDisplayName, score, homeAway
#             status.type.completed
# ================================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(readr)
  library(httr)
  library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
# NHL season ends in June. If before October, latest finished season = CURRENT_YEAR-1
if (as.integer(format(Sys.Date(), "%m")) < 10) CURRENT_YEAR <- CURRENT_YEAR - 1
SEASONS <- 2013:CURRENT_YEAR
OUT_DIR  <- "docs/NHL/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

DIVS <- c(
  "Boston Bruins"="Atlantic",       "Buffalo Sabres"="Atlantic",
  "Detroit Red Wings"="Atlantic",   "Florida Panthers"="Atlantic",
  "Montréal Canadiens"="Atlantic",  "Montreal Canadiens"="Atlantic",
  "Ottawa Senators"="Atlantic",     "Tampa Bay Lightning"="Atlantic",
  "Toronto Maple Leafs"="Atlantic",
  "Carolina Hurricanes"="Metropolitan","Columbus Blue Jackets"="Metropolitan",
  "New Jersey Devils"="Metropolitan","New York Islanders"="Metropolitan",
  "New York Rangers"="Metropolitan","Philadelphia Flyers"="Metropolitan",
  "Pittsburgh Penguins"="Metropolitan","Washington Capitals"="Metropolitan",
  "Arizona Coyotes"="Central",      "Utah HC"="Central",
  "Utah Hockey Club"="Central",     "Chicago Blackhawks"="Central",
  "Colorado Avalanche"="Central",   "Dallas Stars"="Central",
  "Minnesota Wild"="Central",       "Nashville Predators"="Central",
  "St. Louis Blues"="Central",      "Winnipeg Jets"="Central",
  "Anaheim Ducks"="Pacific",        "Calgary Flames"="Pacific",
  "Edmonton Oilers"="Pacific",      "Los Angeles Kings"="Pacific",
  "San Jose Sharks"="Pacific",      "Seattle Kraken"="Pacific",
  "Vancouver Canucks"="Pacific",    "Vegas Golden Knights"="Pacific"
)

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
    hn  <- comps[[hi]]$team$displayName   # NHL uses full names (e.g. "Boston Bruins")
    an  <- comps[[ai]]$team$displayName
    if (is.na(hs)||is.na(as_)||is.null(hn)||is.null(an)||hs==as_) return(NULL)
    list(winner=if(hs>as_)hn else an, loser=if(hs>as_)an else hn,
         winner_pts=max(hs,as_), loser_pts=min(hs,as_))
  }, error=function(e) NULL)
}

# ── Fetch one date ────────────────────────────────────────────
fetch_day <- function(date_str) {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
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

# ── Fetch full season (Oct through June next year) ────────────
fetch_nhl_season <- function(yr) {
  message("  ESPN API: NHL ", yr, "-", yr+1)
  # Regular season: October through April
  # Playoffs: April through June
  dates <- seq(as.Date(paste0(yr,   "-10-01")),
               min(as.Date(paste0(yr+1, "-06-30")), Sys.Date()),
               by="1 day")
  # Only game days: typically Tue, Thu, Sat, Sun + some weekdays
  # Fetch every day but skip quickly if no events (lightweight HEAD approach)
  all_games <- list()
  for (d in as.character(dates)) {
    ds  <- gsub("-","",d)
    res <- fetch_day(ds)
    if (!is.null(res) && nrow(res)>0) all_games <- c(all_games, list(res))
    Sys.sleep(0.15)
  }
  if (!length(all_games)) return(NULL)
  games <- do.call(rbind, all_games)
  games <- games[!is.na(games$winner) & games$winner!="" &
                 !is.na(games$loser)  & games$loser!=""  &
                 games$winner!=games$loser, ]
  # Cap goal margin at 4 (OT wins are always 1-goal anyway)
  games$winner_pts <- pmin(games$winner_pts, games$loser_pts + 4)
  unique(games)
}

# ── Per-season Elo ─────────────────────────────────────────────
for (yr in SEASONS) {
  message("NHL ", yr, "...")
  g <- fetch_nhl_season(yr)
  if (is.null(g) || nrow(g) < 50) {
    message("  Skipping — ", if(is.null(g)) 0 else nrow(g), " games")
    next
  }
  message("  ", nrow(g), " games")
  elo <- run_elo(g, k=25, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season=yr, conf_map=DIVS, sos_map=sos)
  write_csv(out, file.path(OUT_DIR, paste0("NHL_Elo_", yr, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("NHL done.")
