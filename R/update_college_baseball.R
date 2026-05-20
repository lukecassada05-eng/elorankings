# ================================================================
# R/update_college_baseball.R  —  NCAA D1 Baseball, 2015-current
# Data: ESPN public scoreboard API (no key needed)
# FIX: was iterating weekly dates but ESPN scoreboard needs
#      ?dates=YYYYMMDD format — verified working for CBB.
#      For college baseball specifically, the correct group ID is 11.
#      Add diagnostic output to see if API is returning data at all.
# ================================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(readr)
  library(httr)
  library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
SEASONS      <- 2018:CURRENT_YEAR   # ESPN baseball reliable from ~2018
OUT_DIR      <- "docs/CollegeBaseball/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

CONFS <- c(
  "Florida St"="ACC","Clemson"="ACC","NC State"="ACC","Virginia"="ACC",
  "Wake Forest"="ACC","Georgia Tech"="ACC","Duke"="ACC","Miami"="ACC",
  "Louisville"="ACC","Notre Dame"="ACC","Pitt"="ACC","North Carolina"="ACC",
  "Boston College"="ACC","Stanford"="ACC","SMU"="ACC",
  "Vanderbilt"="SEC","LSU"="SEC","Florida"="SEC","Georgia"="SEC",
  "Tennessee"="SEC","South Carolina"="SEC","Miss St"="SEC","Ole Miss"="SEC",
  "Arkansas"="SEC","Auburn"="SEC","Alabama"="SEC","Kentucky"="SEC",
  "Missouri"="SEC","Texas A&M"="SEC","Oklahoma"="SEC","Texas"="SEC",
  "Texas"="Big 12","Oklahoma St"="Big 12","TCU"="Big 12","West Virginia"="Big 12",
  "Baylor"="Big 12","Kansas"="Big 12","Kansas St"="Big 12","Texas Tech"="Big 12",
  "Arizona"="Big 12","Arizona St"="Big 12","BYU"="Big 12","UCF"="Big 12",
  "Cincinnati"="Big 12","Houston"="Big 12","Utah"="Big 12",
  "Michigan"="Big Ten","Ohio St"="Big Ten","Nebraska"="Big Ten",
  "Minnesota"="Big Ten","Indiana"="Big Ten","Maryland"="Big Ten",
  "Rutgers"="Big Ten","Penn St"="Big Ten","Illinois"="Big Ten",
  "Iowa"="Big Ten","Purdue"="Big Ten","Northwestern"="Big Ten",
  "Oregon St"="Pac-12","Oregon"="Pac-12","UCLA"="Pac-12","USC"="Pac-12",
  "East Carolina"="AAC","Tulane"="AAC","Houston"="AAC","Memphis"="AAC",
  "South Florida"="AAC","Wichita St"="AAC","UCF"="AAC",
  "Southern Miss"="Sun Belt","Louisiana"="Sun Belt","Coastal Car"="Sun Belt",
  "Troy"="Sun Belt","Georgia So"="Sun Belt","Arkansas St"="Sun Belt",
  "South Alabama"="Sun Belt","App State"="Sun Belt","UL Monroe"="Sun Belt"
)

# ── Fetch one day's games ─────────────────────────────────────
fetch_day <- function(date_str) {
  # date_str = "20240315" (YYYYMMDD)
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard",
        query=list(limit=300, dates=date_str, groups=11),
        timeout(20)),
    error=function(e) NULL
  )
  if (is.null(resp) || status_code(resp) != 200) return(NULL)
  data <- tryCatch(fromJSON(rawToChar(resp$content), simplifyDataFrame=FALSE),
                   error=function(e) NULL)
  if (is.null(data) || length(data$events)==0) return(NULL)

  rows <- lapply(data$events, function(ev) {
    tryCatch({
      comp <- ev$competitions[[1]]
      if (!isTRUE(comp$status$type$completed)) return(NULL)
      competitors <- comp$competitors
      if (length(competitors) != 2) return(NULL)
      hi <- which(sapply(competitors, `[[`, "homeAway") == "home")
      ai <- which(sapply(competitors, `[[`, "homeAway") == "away")
      if (!length(hi)||!length(ai)) return(NULL)
      hs  <- suppressWarnings(as.numeric(competitors[[hi]]$score))
      as_ <- suppressWarnings(as.numeric(competitors[[ai]]$score))
      hn  <- competitors[[hi]]$team$shortDisplayName
      an  <- competitors[[ai]]$team$shortDisplayName
      if (is.na(hs)||is.na(as_)||is.null(hn)||is.null(an)||hs==as_) return(NULL)
      list(winner=if(hs>as_)hn else an, loser=if(hs>as_)an else hn,
           winner_pts=max(hs,as_), loser_pts=min(hs,as_))
    }, error=function(e) NULL)
  })
  rows <- Filter(Negate(is.null), rows)
  if (!length(rows)) return(NULL)
  data.frame(
    winner=sapply(rows,`[[`,"winner"), loser=sapply(rows,`[[`,"loser"),
    winner_pts=as.numeric(sapply(rows,`[[`,"winner_pts")),
    loser_pts=as.numeric(sapply(rows,`[[`,"loser_pts")),
    stringsAsFactors=FALSE
  )
}

# ── Fetch full season ─────────────────────────────────────────
fetch_cbase_season <- function(yr) {
  message("  ESPN API: College Baseball ", yr)
  # Season: Feb 14 through June 30
  dates <- seq(as.Date(paste0(yr,"-02-14")),
               min(as.Date(paste0(yr,"-06-30")), Sys.Date()),
               by="1 day")
  # Only fetch Fridays-Sundays + Tuesdays (most college baseball days)
  dates <- dates[weekdays(dates) %in% c("Tuesday","Friday","Saturday","Sunday")]

  all_games <- list()
  n_days <- 0
  for (d in as.character(dates)) {
    ds  <- gsub("-","",d)
    res <- fetch_day(ds)
    if (!is.null(res) && nrow(res)>0) {
      all_games <- c(all_games, list(res))
      n_days <- n_days + 1
    }
    Sys.sleep(0.15)
  }
  message("  Days with games: ", n_days)
  if (!length(all_games)) return(NULL)

  games <- do.call(rbind, all_games)
  games <- games[!is.na(games$winner) & games$winner!="" &
                 !is.na(games$loser)  & games$loser!=""  &
                 games$winner!=games$loser, ]
  # Cap run margin at 12
  games$winner_pts <- pmin(games$winner_pts, games$loser_pts + 12)
  unique(games)
}

for (yr in SEASONS) {
  message("College Baseball ", yr, "...")
  g <- fetch_cbase_season(yr)
  if (is.null(g)||nrow(g)<100) {
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
