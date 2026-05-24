# ================================================================
# R/update_nhl.R  —  NHL Elo, 2013–current
# Data: ESPN scoreboard API (dates=YYYYMMDD)
#
# FIXES:
#  1. Filter out All-Star / Heritage Classic / outdoor game "teams"
#     by checking against allowlist of real NHL franchises
#  2. Comprehensive historical alias map (Thrashers→Jets, Coyotes→
#     Utah HC, Nordiques, Whalers, etc.)
#  3. Scores <2 filtered as likely All-Star skill competition results
# ================================================================
suppressPackageStartupMessages({
  library(dplyr); library(readr); library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR  <- as.integer(format(Sys.Date(), "%Y"))
CURRENT_MONTH <- as.integer(format(Sys.Date(), "%m"))
# NHL season: Oct(yr) through Jun(yr+1); CSV named by spring year
# e.g. 2024-25 season → season 2025
CURRENT_SEASON <- if (CURRENT_MONTH >= 10) CURRENT_YEAR + 1L else CURRENT_YEAR
NEXT_SEASON    <- CURRENT_SEASON + 1L
SEASONS        <- c(CURRENT_SEASON, NEXT_SEASON)
message("NHL: updating seasons ", paste(SEASONS, collapse=", "))
OUT_DIR  <- "docs/NHL/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Allowlist of real NHL franchises (all eras) ───────────────
NHL_TEAMS <- c(
  "Anaheim Ducks","Atlanta Thrashers","Arizona Coyotes","Utah Hockey Club",
  "Utah HC","Boston Bruins","Buffalo Sabres","Calgary Flames",
  "Carolina Hurricanes","Hartford Whalers","Chicago Blackhawks",
  "Colorado Avalanche","Quebec Nordiques","Columbus Blue Jackets",
  "Dallas Stars","Minnesota North Stars","Detroit Red Wings",
  "Edmonton Oilers","Florida Panthers","Los Angeles Kings",
  "Minnesota Wild","Montréal Canadiens","Montreal Canadiens",
  "Nashville Predators","New Jersey Devils","New York Islanders",
  "New York Rangers","Ottawa Senators","Philadelphia Flyers",
  "Pittsburgh Penguins","San Jose Sharks","Seattle Kraken",
  "St. Louis Blues","Tampa Bay Lightning","Toronto Maple Leafs",
  "Vancouver Canucks","Vegas Golden Knights","Washington Capitals",
  "Winnipeg Jets"
)
NHL_SET <- toupper(NHL_TEAMS)

# ── Division map (covers all realignment eras) ────────────────
DIVS <- c(
  # Atlantic
  "Boston Bruins"="Atlantic","Buffalo Sabres"="Atlantic",
  "Detroit Red Wings"="Atlantic","Florida Panthers"="Atlantic",
  "Montréal Canadiens"="Atlantic","Montreal Canadiens"="Atlantic",
  "Ottawa Senators"="Atlantic","Tampa Bay Lightning"="Atlantic",
  "Toronto Maple Leafs"="Atlantic",
  # Metropolitan
  "Carolina Hurricanes"="Metropolitan","Columbus Blue Jackets"="Metropolitan",
  "New Jersey Devils"="Metropolitan","New York Islanders"="Metropolitan",
  "New York Rangers"="Metropolitan","Philadelphia Flyers"="Metropolitan",
  "Pittsburgh Penguins"="Metropolitan","Washington Capitals"="Metropolitan",
  # Central
  "Arizona Coyotes"="Central","Utah Hockey Club"="Central","Utah HC"="Central",
  "Chicago Blackhawks"="Central","Colorado Avalanche"="Central",
  "Dallas Stars"="Central","Minnesota Wild"="Central",
  "Nashville Predators"="Central","St. Louis Blues"="Central",
  "Winnipeg Jets"="Central","Atlanta Thrashers"="Central",
  # Pacific
  "Anaheim Ducks"="Pacific","Calgary Flames"="Pacific",
  "Edmonton Oilers"="Pacific","Los Angeles Kings"="Pacific",
  "San Jose Sharks"="Pacific","Seattle Kraken"="Pacific",
  "Vancouver Canucks"="Pacific","Vegas Golden Knights"="Pacific",
  # Pre-2013 conferences (for older seasons if added later)
  "Hartford Whalers"="Northeast","Quebec Nordiques"="Northeast",
  "Minnesota North Stars"="Norris"
)

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
    # Filter: must be real teams, scores must look like hockey (2+)
    if (is.na(hs)||is.na(as_)||is.null(hn)||is.null(an)) return(NULL)
    if (!toupper(hn) %in% NHL_SET || !toupper(an) %in% NHL_SET) return(NULL)
    if (hs == as_ || (hs < 2 && as_ < 2)) return(NULL)
    # Cap margin at 4 (OT wins counted)
    wp <- pmin(max(hs,as_), min(hs,as_) + 4)
    lp <- min(hs,as_)
    list(winner=if(hs>as_)hn else an, loser=if(hs>as_)an else hn,
         winner_pts=wp, loser_pts=lp)
  }, error=function(e) NULL)
}

fetch_nhl_chunk <- function(date_from, date_to) {
  # Fetch a date range in one request using the dates= range parameter
  ds <- gsub("-", "", as.character(date_from))
  de <- gsub("-", "", as.character(date_to))
  url_str <- paste0(
    "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
    "?dates=", ds, "-", de, "&limit=500"
  )
  data <- tryCatch(
    jsonlite::fromJSON(url_str, simplifyVector = FALSE),
    error = function(e) NULL
  )
  if (is.null(data) || length(data$events) == 0) return(NULL)
  rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
  if (!length(rows)) return(NULL)
  data.frame(winner=sapply(rows,`[[`,"winner"), loser=sapply(rows,`[[`,"loser"),
             winner_pts=as.numeric(sapply(rows,`[[`,"winner_pts")),
             loser_pts=as.numeric(sapply(rows,`[[`,"loser_pts")),
             stringsAsFactors=FALSE)
}

fetch_nhl_season <- function(yr) {
  seas_start <- as.Date(paste0(yr, "-10-01"))
  # Include playoffs: season ends by late June of following year
  seas_end   <- min(as.Date(paste0(yr + 1, "-06-30")), Sys.Date())
  message("  ESPN API: NHL ", yr, "-", yr + 1)
  if (seas_start > seas_end) {
    message("  Season hasn\'t started yet — skipping")
    return(NULL)
  }
  # Fetch in 14-day chunks (reduces 236 requests to ~17)
  chunk_starts <- seq(seas_start, seas_end, by = "14 days")
  all_games <- list()
  for (cs in as.character(chunk_starts)) {
    ce <- min(as.Date(cs) + 13, seas_end)
    res <- fetch_nhl_chunk(as.Date(cs), ce)
    if (!is.null(res) && nrow(res) > 0) all_games <- c(all_games, list(res))
    Sys.sleep(0.2)
  }
  if (!length(all_games)) return(NULL)
  games <- unique(do.call(rbind, all_games))
  games[!is.na(games$winner) & games$winner != "" & games$winner != games$loser, ]
}

for (yr in SEASONS) {
  message("NHL ", yr, "...")
  g <- fetch_nhl_season(yr)
  if (is.null(g)||nrow(g)<50) { message("  Skip — ",if(is.null(g))0 else nrow(g)," games"); next }
  message("  ", nrow(g), " games")
  elo <- run_elo(g, k=25, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season=yr, conf_map=DIVS, sos_map=sos)
  write_csv(out, file.path(OUT_DIR, paste0("NHL_Elo_", yr, ".csv")))
  message("  -> ", nrow(out), " teams | NA conf: ", sum(is.na(out$conference)))
}
message("NHL done.")
