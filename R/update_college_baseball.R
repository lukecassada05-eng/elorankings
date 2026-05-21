# ================================================================
# R/update_college_baseball.R  —  NCAA D1 Baseball, 2018-current
# Data: ESPN public scoreboard API
# Endpoint: site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard
#
# FIX: groups=11 sometimes returns 0 events even when games exist.
# Strategy: fetch WITHOUT groups first (gets all NCAA baseball),
# then if that fails try groups=11. College baseball plays mostly
# Tue/Fri/Sat/Sun but also some Wednesdays and Mondays in late season.
# ================================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(readr)
  library(httr)
  library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
SEASONS  <- 2018:CURRENT_YEAR
OUT_DIR  <- "docs/CollegeBaseball/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

CONFS <- c(
  "Florida St"="ACC","Clemson"="ACC","NC State"="ACC","Virginia"="ACC",
  "Wake Forest"="ACC","Georgia Tech"="ACC","Duke"="ACC","Miami"="ACC",
  "Louisville"="ACC","Notre Dame"="ACC","Pitt"="ACC","North Carolina"="ACC",
  "Boston College"="ACC","Stanford"="ACC","SMU"="ACC","Cal"="ACC",
  "Florida State"="ACC","North Carolina St"="ACC",
  "Vanderbilt"="SEC","LSU"="SEC","Florida"="SEC","Georgia"="SEC",
  "Tennessee"="SEC","South Carolina"="SEC","Miss St"="SEC","Ole Miss"="SEC",
  "Arkansas"="SEC","Auburn"="SEC","Alabama"="SEC","Kentucky"="SEC",
  "Missouri"="SEC","Texas A&M"="SEC","Oklahoma"="SEC","Texas"="SEC",
  "Mississippi State"="SEC",
  "Texas"="Big 12","Oklahoma St"="Big 12","TCU"="Big 12",
  "West Virginia"="Big 12","Baylor"="Big 12","Kansas"="Big 12",
  "Kansas St"="Big 12","Texas Tech"="Big 12","Arizona"="Big 12",
  "Arizona St"="Big 12","BYU"="Big 12","UCF"="Big 12",
  "Cincinnati"="Big 12","Houston"="Big 12","Utah"="Big 12",
  "Oklahoma State"="Big 12","Kansas State"="Big 12","Arizona State"="Big 12",
  "Michigan"="Big Ten","Ohio St"="Big Ten","Nebraska"="Big Ten",
  "Minnesota"="Big Ten","Indiana"="Big Ten","Maryland"="Big Ten",
  "Rutgers"="Big Ten","Penn St"="Big Ten","Illinois"="Big Ten",
  "Iowa"="Big Ten","Purdue"="Big Ten","Northwestern"="Big Ten",
  "Ohio State"="Big Ten","Penn State"="Big Ten",
  "Oregon St"="Pac-12","Oregon"="Pac-12","UCLA"="Pac-12","USC"="Pac-12",
  "Arizona"="Pac-12","Arizona St"="Pac-12","Washington"="Pac-12",
  "Oregon State"="Pac-12","Arizona State"="Pac-12",
  "East Carolina"="AAC","Tulane"="AAC","Houston"="AAC","Memphis"="AAC",
  "South Florida"="AAC","Wichita St"="AAC","UCF"="AAC","Navy"="AAC",
  "Southern Miss"="Sun Belt","Louisiana"="Sun Belt","Coastal Car"="Sun Belt",
  "Troy"="Sun Belt","GA Southern"="Sun Belt","Arkansas St"="Sun Belt",
  "Georgia So"="Sun Belt","South Alabama"="Sun Belt","App State"="Sun Belt",
  "UL Monroe"="Sun Belt","Georgia St"="Sun Belt",
  "Coastal Carolina"="Sun Belt","Arkansas State"="Sun Belt",
  "Georgia Southern"="Sun Belt","Appalachian State"="Sun Belt"
)

# ── Parse one ESPN event ──────────────────────────────────────
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
    hn  <- comps[[hi]]$team$shortDisplayName
    an  <- comps[[ai]]$team$shortDisplayName
    if (is.na(hs)||is.na(as_)||is.null(hn)||is.null(an)||hs==as_) return(NULL)
    list(winner=if(hs>as_)hn else an, loser=if(hs>as_)an else hn,
         winner_pts=max(hs,as_), loser_pts=min(hs,as_))
  }, error=function(e) NULL)
}

# ── Fetch one date — try without groups first, fallback groups=11 ──
fetch_date <- function(date_str) {
  base_url <- "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard"

  # Try 1: no groups filter (returns all NCAA baseball)
  for (query in list(
    list(dates=date_str, limit=500),          # no groups
    list(dates=date_str, limit=500, groups=11) # D1 only
  )) {
    resp <- tryCatch(
      GET(base_url, query=query, timeout(20)),
      error=function(e) NULL
    )
    if (is.null(resp) || status_code(resp) != 200) next
    data <- tryCatch(fromJSON(rawToChar(resp$content), simplifyDataFrame=FALSE),
                     error=function(e) NULL)
    if (is.null(data) || length(data$events)==0) next

    rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
    if (length(rows) > 0) {
      return(data.frame(
        winner=sapply(rows,`[[`,"winner"), loser=sapply(rows,`[[`,"loser"),
        winner_pts=as.numeric(sapply(rows,`[[`,"winner_pts")),
        loser_pts=as.numeric(sapply(rows,`[[`,"loser_pts")),
        stringsAsFactors=FALSE
      ))
    }
  }
  NULL
}

# ── Fetch full season ─────────────────────────────────────────
fetch_cbase_season <- function(yr) {
  message("  ESPN API: College Baseball ", yr)
  # Season: Feb 14 - Jun 30 (CWS ends late June)
  dates <- seq(as.Date(paste0(yr, "-02-14")),
               min(as.Date(paste0(yr, "-06-30")), Sys.Date()),
               by = "1 day")
  # Fetch every day (college baseball is played Mon-Sun throughout)
  all_games <- list()
  n_days <- 0
  for (d in as.character(dates)) {
    res <- fetch_date(gsub("-","",d))
    if (!is.null(res) && nrow(res) > 0) {
      all_games <- c(all_games, list(res))
      n_days <- n_days + 1
    }
    Sys.sleep(0.15)
  }
  message("  Days with games: ", n_days)
  if (!length(all_games)) return(NULL)

  games <- do.call(rbind, all_games)
  games <- games[!is.na(games$winner) & games$winner != "" &
                 !is.na(games$loser)  & games$loser  != "" &
                 games$winner != games$loser, ]
  # Cap run margin at 12
  games$winner_pts <- pmin(games$winner_pts, games$loser_pts + 12)
  unique(games)
}

# ── Per-season Elo ─────────────────────────────────────────────
for (yr in SEASONS) {
  message("College Baseball ", yr, "...")
  g <- fetch_cbase_season(yr)
  if (is.null(g) || nrow(g) < 50) {
    message("  Skipping — ", if(is.null(g)) 0 else nrow(g), " games")
    next
  }
  message("  Total: ", nrow(g), " games")
  elo <- run_elo(g, k=30, iters=10, min_games=5)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season=yr, conf_map=CONFS, sos_map=sos)
  out <- as.data.frame(lapply(out, function(x) {
    if(is.list(x)) sapply(x, function(v) if(is.null(v)) NA else as.character(v))
    else x
  }), stringsAsFactors=FALSE)
  write_csv(out, file.path(OUT_DIR, paste0("CBASE_Elo_", yr, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("College Baseball done.")
