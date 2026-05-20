# ================================================================
# R/update_cfb.R
# College Football Elo by season, 2005-current
# Data source: ESPN public scoreboard API (NO KEY REQUIRED)
# Endpoint: site.api.espn.com/apis/site/v2/sports/football/
#           college-football/scoreboard
# Verified fields from live API (tested 2025-05-20):
#   competitors[].team.shortDisplayName
#   competitors[].score
#   competitors[].homeAway
#   status.type.completed
# groups=80 = FBS (Division I-A)
# ================================================================

suppressPackageStartupMessages({
  library(dplyr)
  library(readr)
  library(httr)
  library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
if (as.integer(format(Sys.Date(), "%m")) < 8) CURRENT_YEAR <- CURRENT_YEAR - 1
SEASONS <- 2005:CURRENT_YEAR
OUT_DIR  <- "CFB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Conference map (short ESPN display names) ─────────────────
CONFS <- c(
  "Clemson"="ACC","Florida St"="ACC","Miami"="ACC","NC State"="ACC",
  "North Carolina"="ACC","Duke"="ACC","Virginia"="ACC","Virginia Tech"="ACC",
  "Georgia Tech"="ACC","Wake Forest"="ACC","Louisville"="ACC","Pitt"="ACC",
  "Syracuse"="ACC","Notre Dame"="ACC","Boston College"="ACC","Stanford"="ACC",
  "SMU"="ACC","California"="ACC",
  "Michigan"="Big Ten","Ohio St"="Big Ten","Penn St"="Big Ten",
  "Michigan St"="Big Ten","Minnesota"="Big Ten","Wisconsin"="Big Ten",
  "Iowa"="Big Ten","Purdue"="Big Ten","Illinois"="Big Ten","Indiana"="Big Ten",
  "Rutgers"="Big Ten","Maryland"="Big Ten","Nebraska"="Big Ten",
  "Northwestern"="Big Ten","UCLA"="Big Ten","USC"="Big Ten",
  "Washington"="Big Ten","Oregon"="Big Ten",
  "Texas"="Big 12","Oklahoma"="Big 12","Baylor"="Big 12","TCU"="Big 12",
  "Oklahoma St"="Big 12","Kansas St"="Big 12","Iowa St"="Big 12",
  "Texas Tech"="Big 12","Kansas"="Big 12","West Virginia"="Big 12",
  "BYU"="Big 12","Cincinnati"="Big 12","UCF"="Big 12","Houston"="Big 12",
  "Arizona"="Big 12","Arizona St"="Big 12","Colorado"="Big 12","Utah"="Big 12",
  "Alabama"="SEC","Georgia"="SEC","LSU"="SEC","Florida"="SEC",
  "Tennessee"="SEC","Auburn"="SEC","Ole Miss"="SEC","Miss St"="SEC",
  "Arkansas"="SEC","Kentucky"="SEC","Missouri"="SEC","South Carolina"="SEC",
  "Vanderbilt"="SEC","Texas A&M"="SEC",
  "Boise St"="Mountain West","San Diego St"="Mountain West",
  "Fresno St"="Mountain West","Utah St"="Mountain West","UNLV"="Mountain West",
  "Wyoming"="Mountain West","Nevada"="Mountain West","New Mexico"="Mountain West",
  "Air Force"="Mountain West","Colorado St"="Mountain West",
  "San José St"="Mountain West","Hawai'i"="Mountain West",
  "Memphis"="AAC","Tulane"="AAC","Navy"="AAC","East Carolina"="AAC",
  "South Florida"="AAC","Temple"="AAC",
  "Louisiana"="Sun Belt","App State"="Sun Belt","Troy"="Sun Belt",
  "Georgia So"="Sun Belt","Arkansas St"="Sun Belt","South Alabama"="Sun Belt",
  "James Madison"="Sun Belt","Marshall"="Sun Belt","Old Dominion"="Sun Belt",
  "Georgia St"="Sun Belt","UL Monroe"="Sun Belt","Southern Miss"="Sun Belt",
  "Texas St"="Sun Belt",
  "UAB"="C-USA","Western KY"="C-USA","Middle Tennessee"="C-USA",
  "Liberty"="C-USA","New Mexico St"="C-USA","Sam Houston"="C-USA",
  "Jacksonville St"="C-USA","FIU"="C-USA","UTEP"="C-USA",
  "Louisiana Tech"="C-USA","UTSA"="C-USA","Rice"="C-USA"
)

# ── Fetch one week from ESPN ──────────────────────────────────
fetch_week <- function(date_str) {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
        query = list(limit = 300, dates = date_str, groups = 80),
        timeout(25)),
    error = function(e) NULL
  )
  if (is.null(resp) || status_code(resp) != 200) return(NULL)

  data <- tryCatch(
    fromJSON(rawToChar(resp$content), simplifyDataFrame = FALSE),
    error = function(e) NULL
  )
  if (is.null(data) || length(data$events) == 0) return(NULL)

  results <- lapply(data$events, function(ev) {
    tryCatch({
      comp <- ev$competitions[[1]]
      if (!isTRUE(comp$status$type$completed)) return(NULL)
      competitors <- comp$competitors
      if (length(competitors) != 2) return(NULL)
      hi <- which(sapply(competitors, `[[`, "homeAway") == "home")
      ai <- which(sapply(competitors, `[[`, "homeAway") == "away")
      if (!length(hi) || !length(ai)) return(NULL)
      hs  <- suppressWarnings(as.numeric(competitors[[hi]]$score))
      as_ <- suppressWarnings(as.numeric(competitors[[ai]]$score))
      hn  <- competitors[[hi]]$team$shortDisplayName
      an  <- competitors[[ai]]$team$shortDisplayName
      if (is.na(hs) || is.na(as_) || is.null(hn) || is.null(an) || hs == as_) return(NULL)
      data.frame(winner = if(hs>as_) hn else an, loser = if(hs>as_) an else hn,
                 winner_pts = max(hs,as_), loser_pts = min(hs,as_),
                 stringsAsFactors = FALSE)
    }, error = function(e) NULL)
  })
  bind_rows(Filter(Negate(is.null), results))
}

# ── Full season fetch (weekly dates Aug-Jan) ──────────────────
fetch_cfb_season <- function(yr) {
  message("  ESPN API: CFB ", yr)
  dates <- c(
    seq(as.Date(paste0(yr,   "-08-24")), as.Date(paste0(yr,   "-12-10")), by="7 days"),
    seq(as.Date(paste0(yr,   "-12-15")), as.Date(paste0(yr+1, "-01-25")), by="7 days")
  )
  dates <- dates[dates <= Sys.Date()]
  if (!length(dates)) return(NULL)

  games <- bind_rows(lapply(as.character(dates), function(d) {
    res <- fetch_week(gsub("-","",d))
    Sys.sleep(0.3)
    res
  }))
  if (!nrow(games)) return(NULL)
  distinct(filter(games, !is.na(winner), winner != "", winner != loser))
}

# ── Per-season Elo ─────────────────────────────────────────────
for (yr in SEASONS) {
  message("CFB ", yr, "...")
  g <- fetch_cfb_season(yr)
  if (is.null(g) || nrow(g) < 100) { message("  Skipping"); next }
  message("  ", nrow(g), " games")
  elo <- run_elo(g, k=30, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season=yr, conf_map=CONFS, sos_map=sos)
  elo_lup <- setNames(elo$elo, elo$team)
  resume  <- tapply(seq_len(nrow(g)), g$winner,
                    function(rows) sum(elo_lup[g$loser[rows]], na.rm=TRUE))
  out$resume_score <- round(resume[out$team], 1)
  write_csv(out, file.path(OUT_DIR, paste0("CFB_Elo_", yr, ".csv")))
  message("  -> ", nrow(out), " teams")
}
message("CFB done.")
