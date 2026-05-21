# ================================================================
# R/update_cfb.R  —  College Football Elo, 2001-current
# Data: ESPN public scoreboard API (dates=YYYYMMDD)
#
# Pre-2014 strategy: ESPN scoreboard supports individual dates going
# back to ~2002. We fetch every Saturday (+ a few Fridays/Thursdays)
# from Aug-Jan for each historical season. This gives full coverage.
# Post-2014: same approach (week+dates was unreliable for older years)
#
# Conference fix: exhaustive name map covering ESPN shortDisplayName
# variations across all years.
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
SEASONS <- 2001:CURRENT_YEAR
OUT_DIR  <- "docs/CFB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Comprehensive conference map ──────────────────────────────
# Covers all ESPN shortDisplayName variants across years 2001-present
CONFS <- c(
  # ACC
  "Clemson"="ACC","Florida St"="ACC","Miami"="ACC","NC State"="ACC",
  "North Carolina"="ACC","Duke"="ACC","Virginia"="ACC","Virginia Tech"="ACC",
  "Georgia Tech"="ACC","Wake Forest"="ACC","Louisville"="ACC","Pitt"="ACC",
  "Pittsburgh"="ACC","Syracuse"="ACC","Notre Dame"="ACC","Boston College"="ACC",
  "Stanford"="ACC","SMU"="ACC","California"="ACC","Cal"="ACC",
  "Maryland"="ACC","Florida State"="ACC","North Carolina St"="ACC",
  # Big Ten
  "Michigan"="Big Ten","Ohio St"="Big Ten","Penn St"="Big Ten",
  "Michigan St"="Big Ten","Minnesota"="Big Ten","Wisconsin"="Big Ten",
  "Iowa"="Big Ten","Purdue"="Big Ten","Illinois"="Big Ten","Indiana"="Big Ten",
  "Rutgers"="Big Ten","Maryland"="Big Ten","Nebraska"="Big Ten",
  "Northwestern"="Big Ten","UCLA"="Big Ten","USC"="Big Ten",
  "Washington"="Big Ten","Oregon"="Big Ten","Penn State"="Big Ten",
  "Ohio State"="Big Ten","Michigan State"="Big Ten",
  # Big 12
  "Texas"="Big 12","Oklahoma"="Big 12","Baylor"="Big 12","TCU"="Big 12",
  "Oklahoma St"="Big 12","Kansas St"="Big 12","Iowa St"="Big 12",
  "Texas Tech"="Big 12","Kansas"="Big 12","West Virginia"="Big 12",
  "BYU"="Big 12","Cincinnati"="Big 12","UCF"="Big 12","Houston"="Big 12",
  "Arizona"="Big 12","Arizona St"="Big 12","Colorado"="Big 12","Utah"="Big 12",
  "Oklahoma State"="Big 12","Kansas State"="Big 12","Iowa State"="Big 12",
  "Texas Christian"="Big 12","Arizona State"="Big 12",
  # Big East (existed until 2013)
  "Connecticut"="Big East","UConn"="Big East","South Florida"="Big East",
  "Rutgers"="Big East","Pittsburgh"="Big East","Cincinnati"="Big East",
  "West Virginia"="Big East","Louisville"="Big East","Syracuse"="Big East",
  # SEC
  "Alabama"="SEC","Georgia"="SEC","LSU"="SEC","Florida"="SEC",
  "Tennessee"="SEC","Auburn"="SEC","Ole Miss"="SEC","Miss St"="SEC",
  "Arkansas"="SEC","Kentucky"="SEC","Missouri"="SEC","South Carolina"="SEC",
  "Vanderbilt"="SEC","Texas A&M"="SEC","Mississippi State"="SEC",
  # Pac-10/Pac-12 (2001-2023)
  "Oregon St"="Pac-12","USC"="Pac-12","UCLA"="Pac-12","Arizona"="Pac-12",
  "Arizona St"="Pac-12","Washington"="Pac-12","Washington St"="Pac-12",
  "Colorado"="Pac-12","Utah"="Pac-12","California"="Pac-12",
  "Stanford"="Pac-12","Oregon"="Pac-12","Oregon State"="Pac-12",
  "Washington State"="Pac-12","Arizona State"="Pac-12",
  # Mountain West
  "Boise St"="Mountain West","San Diego St"="Mountain West",
  "Fresno St"="Mountain West","Utah St"="Mountain West","UNLV"="Mountain West",
  "Wyoming"="Mountain West","Nevada"="Mountain West","New Mexico"="Mountain West",
  "Air Force"="Mountain West","Colorado St"="Mountain West",
  "San José St"="Mountain West","Hawai'i"="Mountain West",
  "Utah State"="Mountain West","Colorado State"="Mountain West",
  "San Jose St"="Mountain West","San Jose State"="Mountain West",
  "Fresno State"="Mountain West","Boise State"="Mountain West",
  # AAC (2013+, formerly Big East)
  "Memphis"="AAC","Tulane"="AAC","Navy"="AAC","East Carolina"="AAC",
  "South Florida"="AAC","Temple"="AAC","SMU"="AAC","Tulsa"="AAC",
  "Houston"="AAC","UCF"="AAC","Cincinnati"="AAC","Wichita St"="AAC",
  # Sun Belt
  "Louisiana"="Sun Belt","App State"="Sun Belt","Troy"="Sun Belt",
  "GA Southern"="Sun Belt","Georgia So"="Sun Belt","Arkansas St"="Sun Belt",
  "South Alabama"="Sun Belt","James Madison"="Sun Belt",
  "Marshall"="Sun Belt","Old Dominion"="Sun Belt","GA St"="Sun Belt",
  "Georgia St"="Sun Belt","UL Monroe"="Sun Belt","Southern Miss"="Sun Belt",
  "Texas St"="Sun Belt","Coastal"="Sun Belt","Coastal Car"="Sun Belt",
  "Appalachian State"="Sun Belt","Arkansas State"="Sun Belt",
  "Georgia Southern"="Sun Belt",
  # C-USA
  "UAB"="C-USA","Western KY"="C-USA","Middle Tennessee"="C-USA","MTSU"="C-USA",
  "Liberty"="C-USA","New Mexico St"="C-USA","Sam Houston"="C-USA",
  "Jax State"="C-USA","Jacksonville St"="C-USA","FIU"="C-USA","UTEP"="C-USA",
  "Louisiana Tech"="C-USA","UTSA"="C-USA","Rice"="C-USA",
  "Kennesaw St"="C-USA","FAU"="C-USA","Florida Atlantic"="C-USA",
  "Charlotte"="C-USA","North Texas"="C-USA","Marshall"="C-USA",
  "Old Dominion"="C-USA","Delaware"="C-USA","Western Kentucky"="C-USA",
  "Middle Tenn"="C-USA","New Mexico State"="C-USA","Jacksonville State"="C-USA",
  # MAC
  "W Michigan"="MAC","C Michigan"="MAC","E Michigan"="MAC","N Illinois"="MAC",
  "Ball State"="MAC","Ohio"="MAC","Toledo"="MAC","Kent State"="MAC",
  "Akron"="MAC","Bowling Green"="MAC","Buffalo"="MAC","Miami OH"="MAC",
  "Western Michigan"="MAC","Central Michigan"="MAC","Eastern Michigan"="MAC",
  "Northern Illinois"="MAC","Kent St"="MAC","Miami (OH)"="MAC",
  # Independents
  "Notre Dame"="Independent","Army"="Independent","BYU"="Independent",
  "UConn"="Independent","Liberty"="Independent","UMass"="Independent",
  "New Mexico St"="Independent","Connecticut"="Independent",
  "Brigham Young"="Independent","Massachusetts"="Independent",
  # WAC (historical)
  "Hawaii"="WAC","Hawai'i"="WAC","Nevada"="WAC","Utah St"="WAC",
  "La Tech"="WAC","Louisiana Tech"="WAC","Fresno St"="WAC",
  "San Jose St"="WAC","UTEP"="WAC","New Mexico St"="WAC","Idaho"="WAC",
  # MWC historical (before Mountain West name settled)
  "TCU"="Mountain West","Air Force"="Mountain West","Colorado St"="Mountain West"
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
    # Also grab conference from notes/groups if available
    list(winner=if(hs>as_)hn else an, loser=if(hs>as_)an else hn,
         winner_pts=max(hs,as_), loser_pts=min(hs,as_))
  }, error=function(e) NULL)
}

# ── Fetch one date (YYYYMMDD) ─────────────────────────────────
fetch_date <- function(date_str) {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
        query=list(dates=date_str, groups=80, limit=300),
        timeout(30)),
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

# ── Build game dates for a CFB season ────────────────────────
# CFB games: Thursdays, Fridays, Saturdays Aug-Dec + bowls Dec-Jan
cfb_game_dates <- function(yr) {
  # Regular season: late Aug through early Dec
  reg_start  <- as.Date(paste0(yr,   "-08-24"))
  reg_end    <- as.Date(paste0(yr,   "-12-07"))
  # Bowl season: mid Dec through mid Jan next year
  bowl_start <- as.Date(paste0(yr,   "-12-15"))
  bowl_end   <- as.Date(paste0(yr+1, "-01-22"))

  all_dates <- seq(reg_start, min(bowl_end, Sys.Date()), by = "1 day")
  # Keep only Thu/Fri/Sat (main CFB days) + bowl season every day
  in_bowl <- all_dates >= bowl_start
  is_game_day <- weekdays(all_dates) %in% c("Thursday","Friday","Saturday") | in_bowl
  all_dates[is_game_day]
}

# ── Fetch full season ─────────────────────────────────────────
fetch_cfb_season <- function(yr) {
  message("  ESPN dates: CFB ", yr)
  dates     <- cfb_game_dates(yr)
  all_games <- list()
  n_days    <- 0

  for (d in as.character(dates)) {
    res <- fetch_date(gsub("-","",d))
    if (!is.null(res) && nrow(res) > 0) {
      all_games <- c(all_games, list(res))
      n_days <- n_days + 1
    }
    Sys.sleep(0.2)
  }

  message("  Days with games: ", n_days)
  if (!length(all_games)) return(NULL)

  games <- do.call(rbind, all_games)
  games <- games[!is.na(games$winner) & games$winner != "" &
                 !is.na(games$loser)  & games$loser  != "" &
                 games$winner != games$loser, ]
  unique(games)
}

# ── Per-season Elo ─────────────────────────────────────────────
for (yr in SEASONS) {
  message("CFB ", yr, "...")
  g <- fetch_cfb_season(yr)

  if (is.null(g) || nrow(g) < 50) {
    message("  Skipping — ", if(is.null(g)) 0 else nrow(g), " games")
    next
  }
  message("  Total: ", nrow(g), " games")

  elo <- run_elo(g, k=30, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  out <- build_output(elo, season=yr, conf_map=CONFS, sos_map=sos)

  # Resume score
  elo_lup <- setNames(elo$elo, elo$team)
  resume  <- tapply(seq_len(nrow(g)), g$winner,
                    function(rows) sum(elo_lup[g$loser[rows]], na.rm=TRUE))
  out$resume_score <- round(resume[out$team], 1)

  # Sanitise list columns
  out <- as.data.frame(lapply(out, function(x) {
    if (is.list(x)) sapply(x, function(v) if(is.null(v)) NA else as.character(v))
    else x
  }), stringsAsFactors=FALSE)

  write_csv(out, file.path(OUT_DIR, paste0("CFB_Elo_", yr, ".csv")))

  # Report conference coverage
  covered <- sum(!is.na(out$conference) & out$games_played >= 5)
  total5  <- sum(out$games_played >= 5)
  message("  -> ", nrow(out), " teams | conf coverage (5+ games): ",
          covered, "/", total5)
}
message("CFB done.")
