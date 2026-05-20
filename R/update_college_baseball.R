# ================================================================
# R/update_college_baseball.R
# NCAA D1 Baseball Elo, 2015-current
# Data: ESPN public scoreboard API (JSON, no key needed)
# Endpoint: site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard
# ================================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(readr)
  library(httr)
  library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
# Baseball season: Feb-June. If before Aug, current year still active.
SEASONS  <- 2015:CURRENT_YEAR
OUT_DIR  <- "CollegeBaseball/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Conference map ────────────────────────────────────────────
CONFS <- c(
  # ACC
  "Florida St"="ACC","Clemson"="ACC","NC State"="ACC","Virginia"="ACC",
  "Wake Forest"="ACC","Georgia Tech"="ACC","Duke"="ACC","Miami"="ACC",
  "Louisville"="ACC","Notre Dame"="ACC","Pitt"="ACC","North Carolina"="ACC",
  "Boston College"="ACC","Syracuse"="ACC","Stanford"="ACC","Cal"="ACC","SMU"="ACC",
  # SEC
  "Vanderbilt"="SEC","LSU"="SEC","Florida"="SEC","Georgia"="SEC",
  "Tennessee"="SEC","South Carolina"="SEC","Miss. St."="SEC","Ole Miss"="SEC",
  "Arkansas"="SEC","Auburn"="SEC","Alabama"="SEC","Kentucky"="SEC",
  "Missouri"="SEC","Texas A&M"="SEC","Oklahoma"="SEC","Texas"="SEC",
  # Big 12
  "Texas"="Big 12","Oklahoma St."="Big 12","TCU"="Big 12","West Virginia"="Big 12",
  "Baylor"="Big 12","Kansas"="Big 12","Kansas St."="Big 12","Texas Tech"="Big 12",
  "Arizona"="Big 12","Arizona St."="Big 12","BYU"="Big 12","UCF"="Big 12",
  "Cincinnati"="Big 12","Houston"="Big 12","Utah"="Big 12",
  # Big Ten
  "Michigan"="Big Ten","Ohio St."="Big Ten","Nebraska"="Big Ten",
  "Minnesota"="Big Ten","Indiana"="Big Ten","Maryland"="Big Ten",
  "Rutgers"="Big Ten","Penn St."="Big Ten","Illinois"="Big Ten",
  "Iowa"="Big Ten","Purdue"="Big Ten","Northwestern"="Big Ten",
  # Pac-12
  "Oregon St."="Pac-12","Oregon"="Pac-12","UCLA"="Pac-12","USC"="Pac-12",
  "Arizona"="Pac-12","Arizona St."="Pac-12","Washington"="Pac-12",
  # AAC
  "East Carolina"="AAC","Tulane"="AAC","Houston"="AAC","Memphis"="AAC",
  "South Florida"="AAC","Wichita St."="AAC","UCF"="AAC","Navy"="AAC",
  # Sun Belt
  "Southern Miss"="Sun Belt","Louisiana"="Sun Belt","Coastal Car."="Sun Belt",
  "Troy"="Sun Belt","Georgia So."="Sun Belt","Arkansas St."="Sun Belt",
  "Georgia St."="Sun Belt","App State"="Sun Belt","South Alabama"="Sun Belt",
  "UL Monroe"="Sun Belt"
)

# ── ESPN API fetcher for one week ─────────────────────────────
fetch_week <- function(date_str) {
  # date_str format: "20250301"
  url <- paste0("https://site.api.espn.com/apis/site/v2/sports/",
                "baseball/college-baseball/scoreboard")
  resp <- tryCatch(
    GET(url, query=list(limit=300, dates=date_str, groups=11),
        timeout(20)),
    error=function(e) NULL
  )
  if (is.null(resp) || status_code(resp) != 200) return(NULL)

  data <- tryCatch(
    fromJSON(rawToChar(resp$content), simplifyDataFrame=FALSE),
    error=function(e) NULL
  )
  if (is.null(data) || length(data$events)==0) return(NULL)

  results <- lapply(data$events, function(ev) {
    tryCatch({
      comp <- ev$competitions[[1]]
      if (!isTRUE(comp$status$type$completed)) return(NULL)
      comps <- comp$competitors
      if (length(comps) != 2) return(NULL)

      home_i <- which(sapply(comps, function(c) c$homeAway) == "home")
      away_i <- which(sapply(comps, function(c) c$homeAway) == "away")
      if (length(home_i)==0 || length(away_i)==0) return(NULL)

      hs <- as.numeric(comps[[home_i]]$score)
      as_ <- as.numeric(comps[[away_i]]$score)
      hn  <- comps[[home_i]]$team$shortDisplayName
      an  <- comps[[away_i]]$team$shortDisplayName

      if (is.na(hs)||is.na(as_)||hs==as_||is.null(hn)||is.null(an)) return(NULL)

      data.frame(
        winner     = if(hs>as_) hn else an,
        loser      = if(hs>as_) an else hn,
        winner_pts = max(hs,as_),
        loser_pts  = min(hs,as_),
        stringsAsFactors=FALSE
      )
    }, error=function(e) NULL)
  })
  bind_rows(Filter(Negate(is.null), results))
}

# ── Per-season Elo ────────────────────────────────────────────
for (yr in SEASONS) {
  message("College Baseball ", yr, "...")

  # Weekly dates Feb 1 to Jun 30
  dates <- seq(as.Date(paste0(yr,"-02-01")),
               min(as.Date(paste0(yr,"-06-30")), Sys.Date()),
               by="7 days")

  all_games <- bind_rows(lapply(as.character(dates), function(d) {
    ds <- gsub("-","",d)
    res <- fetch_week(ds)
    Sys.sleep(0.25)   # polite delay
    res
  }))

  if (is.null(all_games) || nrow(all_games) < 100) {
    message("  Skipping — insufficient games"); next
  }

  all_games <- all_games %>%
    filter(!is.na(winner), !is.na(loser), winner!="", loser!="",
           winner!=loser) %>%
    # Cap run margin at 12
    mutate(winner_pts = pmin(winner_pts, loser_pts + 12))

  elo <- run_elo(all_games, k=30, iters=10, min_games=5)
  elo <- attach_best_wins(elo, all_games)
  sos <- compute_sos(all_games, elo)
  out <- build_output(elo, season=yr, conf_map=CONFS, sos_map=sos)

  write_csv(out, file.path(OUT_DIR, paste0("CBASE_Elo_", yr, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("College Baseball done.")
