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
  library(dplyr); library(readr); library(httr); library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR  <- as.integer(format(Sys.Date(), "%Y"))
CURRENT_MONTH <- as.integer(format(Sys.Date(), "%m"))
# NHL season: Oct(yr) through Jun(yr+1); CSV named by spring year
# e.g. 2024-25 season → season 2025
CURRENT_SEASON <- if (CURRENT_MONTH >= 10) CURRENT_YEAR + 1L else CURRENT_YEAR
NEXT_SEASON    <- CURRENT_SEASON + 1L
# Update all seasons from 2014 (first full season) through current
# This fixes any historical inaccuracies and keeps current season fresh
SEASONS <- 2014:CURRENT_SEASON
message("NHL: updating seasons 2014-", CURRENT_SEASON)
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

fetch_day <- function(ds) {
  resp <- tryCatch(
    httr::GET(
      "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
      query = list(dates = ds, limit = 50),
      httr::timeout(20)
    ),
    error = function(e) NULL
  )
  if (is.null(resp) || httr::status_code(resp) != 200) return(NULL)
  data <- tryCatch(
    jsonlite::fromJSON(httr::content(resp, "text", encoding="UTF-8"),
                       simplifyVector = FALSE),
    error = function(e) NULL
  )
  if (is.null(data) || length(data$events) == 0) return(NULL)
  rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
  if (!length(rows)) return(NULL)
  data.frame(
    winner     = sapply(rows, `[[`, "winner"),
    loser      = sapply(rows, `[[`, "loser"),
    winner_pts = as.numeric(sapply(rows, `[[`, "winner_pts")),
    loser_pts  = as.numeric(sapply(rows, `[[`, "loser_pts")),
    stringsAsFactors = FALSE
  )
}

fetch_nhl_season <- function(yr) {
  seas_start <- as.Date(paste0(yr - 1, "-10-01"))
  seas_end   <- min(as.Date(paste0(yr, "-06-30")), Sys.Date())
  message("  ESPN API: NHL ", yr - 1, "-", yr,
          " (", as.integer(seas_end - seas_start), " days)")
  if (seas_start > Sys.Date()) {
    message("  Season hasn\'t started yet — skipping")
    return(NULL)
  }
  dates     <- seq(seas_start, seas_end, by = "1 day")
  all_games <- list()
  n_found   <- 0L
  for (d in as.character(dates)) {
    res <- fetch_day(gsub("-", "", d))
    if (!is.null(res) && nrow(res) > 0) {
      all_games <- c(all_games, list(res))
      n_found   <- n_found + nrow(res)
    }
    Sys.sleep(0.05)
  }
  message("  Found ", n_found, " game results across ", length(dates), " dates")
  if (!length(all_games)) return(NULL)
  games <- unique(do.call(rbind, all_games))
  games[!is.na(games$winner) & games$winner != "" & games$winner != games$loser, ]
}

for (yr in SEASONS) {
  message("NHL ", yr, "...")
  g <- fetch_nhl_season(yr)
  message("  Games found: ", if(is.null(g)) "NULL" else nrow(g))
  if (is.null(g)||nrow(g)<50) { message("  Skip — ",if(is.null(g))0 else nrow(g)," games"); next }
  message("  ", nrow(g), " games")
  elo <- run_elo(g, k=25, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season=yr, conf_map=DIVS, sos_map=sos)
  out_path <- file.path(OUT_DIR, paste0("NHL_Elo_", yr, ".csv"))
  out <- attach_movers(out, out_path)
  write_csv(out, out_path)
  message("  -> ", nrow(out), " teams | NA conf: ", sum(is.na(out$conference)))
}
