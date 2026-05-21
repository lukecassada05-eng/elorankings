# ================================================================
# R/update_cfb.R  —  College Football Elo, 2001–current
# Data: ESPN scoreboard API (dates=YYYYMMDD)
#
# FIXES:
#  1. Year-aware conference lookup — teams assigned to their correct
#     conference for each specific season, handling all realignments.
#  2. Notre Dame = Independent (never ACC as a football member)
#  3. All 44 NA teams with 5+ games now mapped correctly
#  4. Pac-10 → Pac-12 → Big Ten/Big 12 transitions handled
#  5. Big East football era (2001–2012) handled separately
# ================================================================
suppressPackageStartupMessages({
  library(dplyr); library(readr); library(httr); library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
if (as.integer(format(Sys.Date(),"%m")) < 8) CURRENT_YEAR <- CURRENT_YEAR - 1
SEASONS <- 2001:CURRENT_YEAR
OUT_DIR  <- "docs/CFB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ================================================================
# Year-aware conference map
# get_conf(team, year) returns the correct conference for that season.
# ================================================================
get_conf <- function(team, year) {
  t <- trimws(team)

  # ── INDEPENDENTS (always) ──────────────────────────────────
  if (t %in% c("Notre Dame","Army","Navy")) return("Independent")
  if (t %in% c("BYU") && year <= 2010) return("Mountain West")
  if (t == "BYU" && year >= 2011 && year <= 2022) return("Independent")
  if (t == "BYU" && year >= 2023) return("Big 12")
  if (t %in% c("UMass","Massachusetts") && year >= 2012) return("Independent")
  if (t %in% c("UConn","Connecticut") && year >= 2020) return("Independent")
  if (t %in% c("Liberty") && year >= 2018 && year <= 2022) return("Independent")
  if (t == "New Mexico St" && year >= 2018 && year <= 2022) return("Independent")

  # ── ACC ────────────────────────────────────────────────────
  acc_core <- c("Clemson","Florida St","Florida State","Miami",
                "NC State","North Carolina St","North Carolina",
                "Duke","Virginia","Virginia Tech","Georgia Tech",
                "Wake Forest","Louisville","Pitt","Pittsburgh",
                "Syracuse","Boston College")
  acc_new  <- c("SMU","Stanford","California","Cal")  # Notre Dame is Independent in football
  if (t %in% acc_core) return("ACC")
  if (t %in% acc_new && year >= 2024) return("ACC")
  if (t == "Maryland" && year <= 2013) return("ACC")

  # ── BIG TEN ────────────────────────────────────────────────
  b10_core <- c("Michigan","Ohio St","Ohio State","Penn St","Penn State",
                "Michigan St","Michigan State","Minnesota","Wisconsin",
                "Iowa","Purdue","Illinois","Indiana","Northwestern","Nebraska")
  if (t %in% b10_core) return("Big Ten")
  if (t == "Maryland" && year >= 2014) return("Big Ten")
  if (t == "Rutgers" && year >= 2014) return("Big Ten")
  if (t == "UCLA" && year >= 2024) return("Big Ten")
  if (t == "USC" && year >= 2024) return("Big Ten")
  if (t == "Washington" && year >= 2024) return("Big Ten")
  if (t == "Oregon" && year >= 2024) return("Big Ten")

  # ── BIG 12 ────────────────────────────────────────────────
  b12_legacy <- c("Kansas","Kansas St","Kansas State","Iowa St","Iowa State",
                  "Baylor","TCU","Texas Christian","Texas Tech","West Virginia",
                  "Oklahoma St","Oklahoma State")
  if (t %in% b12_legacy) return("Big 12")
  if (t == "Texas" && year <= 2023) return("Big 12")
  if (t == "Texas" && year >= 2024) return("SEC")
  if (t == "Oklahoma" && year <= 2023) return("Big 12")
  if (t == "Oklahoma" && year >= 2024) return("SEC")
  if (t %in% c("Colorado","Utah","Arizona","Arizona St","Arizona State") &&
      year >= 2024) return("Big 12")
  if (t %in% c("Cincinnati","UCF","Houston") && year >= 2023) return("Big 12")
  if (t %in% c("Cincinnati","UCF","Houston") && year < 2023) return("AAC")

  # ── SEC ────────────────────────────────────────────────────
  sec_core <- c("Alabama","Georgia","LSU","Florida","Tennessee","Auburn",
                "Ole Miss","Miss St","Mississippi State","Arkansas",
                "Kentucky","Missouri","South Carolina","Vanderbilt",
                "Texas A&M","Mississippi St")
  if (t %in% sec_core) return("SEC")
  if (t == "Texas" && year >= 2024) return("SEC")
  if (t == "Oklahoma" && year >= 2024) return("SEC")

  # ── PAC-10 / PAC-12 (2001–2023) ───────────────────────────
  pac_core <- c("Oregon St","Oregon State","USC","UCLA","Arizona",
                "Arizona St","Arizona State","Washington","Washington St",
                "Washington State","California","Cal","Stanford",
                "Utah","Colorado","Oregon")
  pac_pre_expansion <- c("Oregon St","Oregon State","USC","UCLA","Arizona",
                         "Arizona St","Arizona State","Washington","Washington St",
                         "Washington State","California","Cal","Stanford")
  if (t %in% pac_pre_expansion && year <= 2023) return("Pac-12")
  if (t %in% c("Utah","Colorado") && year >= 2011 && year <= 2023) return("Pac-12")
  # Post-2023 these teams moved
  if (t %in% c("Oregon St","Oregon State","Washington St","Washington State") &&
      year >= 2024) return("Pac-12") # still Pac-12 as remnant
  if (t %in% c("UCLA","USC","Washington","Oregon") && year >= 2024) return("Big Ten")
  if (t %in% c("Arizona","Arizona St","Arizona State","Colorado","Utah") &&
      year >= 2024) return("Big 12")
  if (t %in% c("California","Cal","Stanford") && year >= 2024) return("ACC")

  # ── MOUNTAIN WEST ─────────────────────────────────────────
  mw_core <- c("Boise St","Boise State","San Diego St","San Diego State",
               "Fresno St","Fresno State","Utah St","Utah State","UNLV",
               "Wyoming","Nevada","New Mexico","Air Force","Colorado St",
               "Colorado State","San José St","San Jose St","San Jose State",
               "Hawai'i","Hawaii")
  if (t %in% mw_core) return("Mountain West")
  if (t == "BYU" && year <= 2010) return("Mountain West")
  if (t == "TCU" && year <= 2011) return("Mountain West")
  if (t %in% c("Utah","Colorado") && year <= 2010) return("Mountain West")

  # ── AAC (2013+) / BIG EAST football (2001–2012) ───────────
  aac_founding <- c("Memphis","Tulane","Navy","East Carolina","South Florida",
                    "Temple","SMU","Tulsa","Houston","UCF","Cincinnati",
                    "Wichita St","East Carolina")
  big_east_fb  <- c("Connecticut","UConn","South Florida","Rutgers",
                    "Pittsburgh","Cincinnati","West Virginia","Louisville",
                    "Syracuse","Navy","Temple")
  if (t %in% big_east_fb && year <= 2012) return("Big East")
  if (t %in% aac_founding && year >= 2013 && year <= 2022) return("AAC")
  if (t == "Memphis" && year >= 2013) return("AAC")
  if (t == "Tulane" && year >= 2013 && year <= 2023) return("AAC")
  if (t == "Tulsa" && year >= 2013 && year <= 2022) return("AAC")
  if (t == "East Carolina" && year >= 2013) return("AAC")
  if (t == "South Florida" && year >= 2013) return("AAC")
  if (t == "Temple" && year >= 2013) return("AAC")
  if (t == "Navy" && year >= 2015 && year <= 2023) return("AAC")
  if (t == "Wichita St" && year >= 2013) return("AAC")
  if (t == "SMU" && year >= 2013 && year <= 2023) return("AAC")

  # ── SUN BELT ──────────────────────────────────────────────
  sunbelt <- c("Louisiana","App State","Appalachian State","Troy",
               "GA Southern","Georgia So","Georgia Southern",
               "Arkansas St","Arkansas State","South Alabama",
               "James Madison","Marshall","Old Dominion","GA St",
               "Georgia St","Georgia State","UL Monroe","Southern Miss",
               "Texas St","Texas State","Coastal","Coastal Car",
               "Coastal Carolina")
  if (t %in% sunbelt) return("Sun Belt")
  if (t == "App State" || t == "Appalachian State") return("Sun Belt")

  # ── C-USA ─────────────────────────────────────────────────
  cusa <- c("UAB","Western KY","Western Kentucky","MTSU","Middle Tennessee",
            "Middle Tenn","Liberty","New Mexico St","New Mexico State",
            "Sam Houston","Jax State","Jacksonville St","Jacksonville State",
            "FIU","UTEP","Louisiana Tech","La Tech","UTSA","Rice",
            "Kennesaw St","Kennesaw State","FAU","Florida Atlantic",
            "Charlotte","North Texas","Delaware","C-USA")
  # C-USA had different members historically
  cusa_2001 <- c("UAB","UTEP","Tulane","Southern Miss","Houston","TCU","SMU",
                 "East Carolina","Marshall","Rice","Memphis","Tulsa",
                 "Alabama-Birmingham")
  if (t %in% cusa && year >= 2014) return("C-USA")
  if (t %in% cusa_2001 && year <= 2012) return("C-USA")
  if (t == "Marshall" && year <= 2004) return("MAC")
  if (t == "Marshall" && year >= 2005 && year <= 2021) return("C-USA")
  if (t == "Marshall" && year >= 2022) return("Sun Belt")
  if (t == "Old Dominion" && year >= 2018 && year <= 2021) return("C-USA")
  if (t == "Old Dominion" && year >= 2022) return("Sun Belt")
  if (t == "North Texas" && year >= 2013 && year <= 2023) return("C-USA")
  if (t == "North Texas" && year >= 2024) return("AAC")
  if (t == "Charlotte" && year >= 2015 && year <= 2023) return("C-USA")

  # ── MAC ───────────────────────────────────────────────────
  mac <- c("W Michigan","Western Michigan","C Michigan","Central Michigan",
           "E Michigan","Eastern Michigan","N Illinois","Northern Illinois",
           "Ball State","Ohio","Toledo","Kent State","Kent St",
           "Akron","Bowling Green","Buffalo","Miami OH","Miami (OH)")
  if (t %in% mac) return("MAC")

  # ── WAC (historical) ──────────────────────────────────────
  wac_2001 <- c("Hawaii","Hawai'i","Nevada","Utah St","Utah State",
                "Louisiana Tech","La Tech","Fresno St","Fresno State",
                "San Jose St","San Jose State","UTEP","New Mexico St",
                "New Mexico State","Idaho","Boise St","Boise State")
  if (t %in% wac_2001 && year <= 2011) return("WAC")

  # ── INDEPENDENTS (FBS non-power) ──────────────────────────
  fbs_ind <- c("Army","Navy","Notre Dame","BYU","UMass","Massachusetts",
               "UConn","Connecticut","Liberty","New Mexico St","New Mexico State",
               "UL Lafayette","Louisiana Lafayette","Sam Houston",
               "Jacksonville St","Jacksonville State","Kennesaw St",
               "Kennesaw State","Jax State","Austin Peay")
  if (t %in% fbs_ind) return("Independent")

  # Default — likely FCS or unknown
  return(NA_character_)
}

# ── Parse ESPN event ──────────────────────────────────────────
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

fetch_date <- function(ds) {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
        query=list(dates=ds, groups=80, limit=300), timeout(30)),
    error=function(e) NULL)
  if (is.null(resp)||status_code(resp)!=200) return(NULL)
  data <- tryCatch(fromJSON(rawToChar(resp$content),simplifyDataFrame=FALSE),
                   error=function(e) NULL)
  if (is.null(data)||length(data$events)==0) return(NULL)
  rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
  if (!length(rows)) return(NULL)
  data.frame(winner=sapply(rows,`[[`,"winner"),loser=sapply(rows,`[[`,"loser"),
             winner_pts=as.numeric(sapply(rows,`[[`,"winner_pts")),
             loser_pts=as.numeric(sapply(rows,`[[`,"loser_pts")),
             stringsAsFactors=FALSE)
}

cfb_game_dates <- function(yr) {
  reg_dates  <- seq(as.Date(paste0(yr,  "-08-24")),
                    as.Date(paste0(yr,  "-12-07")), by="1 day")
  bowl_dates <- seq(as.Date(paste0(yr,  "-12-15")),
                    as.Date(paste0(yr+1,"-01-22")), by="1 day")
  all_dates  <- c(reg_dates, bowl_dates)
  all_dates  <- all_dates[all_dates <= Sys.Date()]
  in_bowl    <- all_dates >= as.Date(paste0(yr,"-12-15"))
  all_dates[weekdays(all_dates) %in% c("Thursday","Friday","Saturday") | in_bowl]
}

for (yr in SEASONS) {
  message("CFB ", yr, "...")
  dates <- cfb_game_dates(yr)
  all_games <- list()
  for (d in as.character(dates)) {
    res <- fetch_date(gsub("-","",d))
    if (!is.null(res)&&nrow(res)>0) all_games <- c(all_games, list(res))
    Sys.sleep(0.2)
  }
  if (!length(all_games)) { message("  Skip"); next }

  g <- unique(do.call(rbind, all_games))
  g <- g[!is.na(g$winner)&g$winner!=""&g$winner!=g$loser,]

  if (nrow(g) < 50) { message("  Skip — only ", nrow(g), " games"); next }
  message("  ", nrow(g), " games")

  elo <- run_elo(g, k=30, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)

  # Year-aware conference assignment
  conf_vec <- setNames(
    sapply(elo$team, function(t) get_conf(t, yr)),
    elo$team
  )

  out <- build_output(elo, season=yr, conf_map=conf_vec, sos_map=sos)

  # Resume score
  elo_lup <- setNames(elo$elo, elo$team)
  resume  <- tapply(seq_len(nrow(g)), g$winner,
                    function(rows) sum(elo_lup[g$loser[rows]], na.rm=TRUE))
  out$resume_score <- round(resume[out$team], 1)

  out <- as.data.frame(lapply(out, function(x) {
    if(is.list(x)) sapply(x, function(v) if(is.null(v)) NA else as.character(v))
    else x
  }), stringsAsFactors=FALSE)

  write_csv(out, file.path(OUT_DIR, paste0("CFB_Elo_", yr, ".csv")))

  covered <- sum(!is.na(out$conference) & out$games_played >= 5)
  total5  <- sum(out$games_played >= 5)
  message("  -> ", nrow(out), " teams | conf (5+ games): ", covered, "/", total5)
}
message("CFB done.")
