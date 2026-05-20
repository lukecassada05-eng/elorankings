# ================================================================
# R/update_cfb.R  —  College Football Elo, 2014-current
# Data: ESPN core API (historical season/week endpoint)
# URL pattern:
#   https://site.api.espn.com/apis/site/v2/sports/football/
#   college-football/scoreboard?groups=80&seasontype=2&week=N&dates=YYYY
# The scoreboard endpoint DOES support historical data when you
# pass ?dates=YYYY (year only, not a full date) together with &week=N
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
# ESPN historical CFB data is solid from 2014 onward
SEASONS <- 2014:CURRENT_YEAR
OUT_DIR  <- "docs/CFB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

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

# ── Parse one event from the JSON ─────────────────────────────
parse_event <- function(ev) {
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
    if (is.na(hs)||is.na(as_)||is.null(hn)||is.null(an)||hn==""||an=="") return(NULL)
    if (hs == as_) return(NULL)
    # Return a simple named list (NOT a data.frame) to avoid list-column issues
    list(winner=if(hs>as_)hn else an, loser=if(hs>as_)an else hn,
         winner_pts=max(hs,as_), loser_pts=min(hs,as_))
  }, error=function(e) NULL)
}

# ── Fetch one week from ESPN (year + week number) ─────────────
# Using ?dates=YYYY&week=N which ESPN supports for historical seasons
fetch_week <- function(yr, week, season_type=2) {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
        query=list(groups=80, seasontype=season_type, week=week, dates=yr, limit=300),
        timeout(30)),
    error=function(e) NULL
  )
  if (is.null(resp) || status_code(resp) != 200) return(NULL)
  data <- tryCatch(fromJSON(rawToChar(resp$content), simplifyDataFrame=FALSE),
                   error=function(e) NULL)
  if (is.null(data) || length(data$events)==0) return(NULL)

  rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
  if (!length(rows)) return(NULL)

  # Build data.frame manually from list to avoid list-column issues
  data.frame(
    winner     = sapply(rows, `[[`, "winner"),
    loser      = sapply(rows, `[[`, "loser"),
    winner_pts = as.numeric(sapply(rows, `[[`, "winner_pts")),
    loser_pts  = as.numeric(sapply(rows, `[[`, "loser_pts")),
    stringsAsFactors = FALSE
  )
}

# ── Fetch full season (weeks 1-15 reg + weeks 1-5 postseason) ─
fetch_cfb_season <- function(yr) {
  message("  ESPN API: CFB ", yr)
  all_games <- list()

  # Regular season: weeks 1-16
  for (wk in 1:16) {
    res <- fetch_week(yr, wk, season_type=2)
    if (!is.null(res) && nrow(res) > 0) {
      all_games <- c(all_games, list(res))
      message("    Week ", wk, ": ", nrow(res), " games")
    }
    Sys.sleep(0.25)
  }

  # Postseason (bowl games, playoffs): season_type=3, weeks 1-6
  for (wk in 1:6) {
    res <- fetch_week(yr, wk, season_type=3)
    if (!is.null(res) && nrow(res) > 0) {
      all_games <- c(all_games, list(res))
      message("    Bowl week ", wk, ": ", nrow(res), " games")
    }
    Sys.sleep(0.25)
  }

  if (!length(all_games)) return(NULL)

  games <- do.call(rbind, all_games)
  games <- games[!is.na(games$winner) & games$winner != "" &
                 !is.na(games$loser)  & games$loser  != "" &
                 games$winner != games$loser, ]
  # Remove duplicates
  games <- unique(games)
  games
}

# ── Per-season Elo ─────────────────────────────────────────────
for (yr in SEASONS) {
  message("CFB ", yr, "...")
  g <- fetch_cfb_season(yr)
  if (is.null(g) || nrow(g) < 50) {
    message("  Skipping — only ", if(is.null(g)) 0 else nrow(g), " games")
    next
  }
  message("  Total: ", nrow(g), " games")

  elo <- run_elo(g, k=30, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season=yr, conf_map=CONFS, sos_map=sos)

  elo_lup <- setNames(elo$elo, elo$team)
  resume  <- tapply(seq_len(nrow(g)), g$winner,
                    function(rows) sum(elo_lup[g$loser[rows]], na.rm=TRUE))
  out$resume_score <- round(resume[out$team], 1)

  # Ensure all columns are atomic (no list columns)
  out <- as.data.frame(lapply(out, function(x) {
    if (is.list(x)) sapply(x, function(v) if(is.null(v)) NA else as.character(v))
    else x
  }), stringsAsFactors=FALSE)

  write_csv(out, file.path(OUT_DIR, paste0("CFB_Elo_", yr, ".csv")))
  message("  -> Saved ", nrow(out), " teams for CFB ", yr)
}
message("CFB done.")
