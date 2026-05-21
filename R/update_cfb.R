# ================================================================
# R/update_cfb.R  —  College Football Elo, 2001–current
# Data: ESPN scoreboard API (dates=YYYYMMDD, groups=80 for FBS)
#
# KEY: get_conf(team, year) handles ALL known ESPN shortDisplayName
# variants and every conference realignment from 2001–present.
# ================================================================
suppressPackageStartupMessages({
  library(dplyr); library(readr); library(httr); library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
if (as.integer(format(Sys.Date(), "%m")) < 8) CURRENT_YEAR <- CURRENT_YEAR - 1
SEASONS <- 2001:CURRENT_YEAR
OUT_DIR  <- "docs/CFB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ================================================================
# Year-aware conference assignment
# Handles ESPN shortDisplayName variants + all realignments
# ================================================================
get_conf <- function(team, year) {
  t <- trimws(team)

  # ── ALWAYS INDEPENDENT ────────────────────────────────────
  if (t %in% c("Notre Dame","Army","Notre Dame Fighting Irish")) return("Independent")
  if (t == "Navy") {
    if (year >= 2015 && year <= 2023) return("AAC")
    return("Independent")  # Navy was ind before AAC, and left AAC 2024
  }
  if (t %in% c("BYU","Brigham Young")) {
    if (year <= 2010) return("Mountain West")
    if (year <= 2022) return("Independent")
    return("Big 12")
  }
  if (t %in% c("UMass","Massachusetts") && year >= 2012) return("Independent")
  if (t %in% c("UConn","Connecticut") && year >= 2020) return("Independent")
  if (t == "Liberty" && year >= 2018 && year <= 2022) return("Independent")
  if (t %in% c("New Mexico St","New Mexico State") && year >= 2018 && year <= 2022) return("Independent")
  if (t == "UConn" && year <= 2019) return("AAC")

  # ── ACC ────────────────────────────────────────────────────
  # ESPN uses "FSU" not "Florida St" and "UNC" not "North Carolina"
  acc_always <- c(
    "Clemson","Miami","NC State","North Carolina St","Duke","Virginia",
    "Virginia Tech","Georgia Tech","Wake Forest","Louisville","Pitt",
    "Pittsburgh","Syracuse","Boston College",
    # ESPN shortDisplayName variants
    "UNC","FSU","GT","VT","BC"
  )
  acc_joined <- list(
    "Florida St"=2001, "Florida State"=2001, "FSU"=2001,
    "North Carolina"=2001, "UNC"=2001,
    "Maryland"=2001,     # left after 2013
    "Stanford"=2024,     "California"=2024, "Cal"=2024,
    "SMU"=2024
  )
  if (t %in% acc_always) {
    # Maryland left ACC after 2013
    if (t == "Maryland" && year >= 2014) return("Big Ten")
    return("ACC")
  }
  year_joined <- acc_joined[[t]]
  if (!is.null(year_joined) && year >= year_joined) {
    if (t %in% c("Maryland") && year >= 2014) return("Big Ten")
    return("ACC")
  }

  # ── BIG TEN ────────────────────────────────────────────────
  b10_always <- c(
    "Michigan","Ohio St","Ohio State","Penn St","Penn State",
    "Michigan St","Michigan State","Minnesota","Wisconsin",
    "Iowa","Purdue","Illinois","Indiana","Northwestern","Nebraska"
  )
  if (t %in% b10_always) return("Big Ten")
  if (t %in% c("Maryland","Rutgers") && year >= 2014) return("Big Ten")
  if (t %in% c("UCLA","USC") && year >= 2024) return("Big Ten")
  if (t %in% c("Washington") && year >= 2024) return("Big Ten")
  if (t == "Oregon" && year >= 2024) return("Big Ten")
  # Oregon was Pac-10/Pac-12 before 2024 — do NOT return "Big Ten" here

  # ── BIG 12 ────────────────────────────────────────────────
  b12_always <- c(
    "Kansas","Kansas St","Kansas State","Iowa St","Iowa State",
    "Baylor","TCU","Texas Christian","Texas Tech","West Virginia"
  )
  if (t %in% b12_always) return("Big 12")
  b12_year <- list(
    "Oklahoma St"=2001,"Oklahoma State"=2001,
    "Texas"=2001,   # Texas left Big 12 after 2023
    "Oklahoma"=2001,# Oklahoma left Big 12 after 2023
    "Colorado"=2001,# Colorado left Big 12 after 2010
    "Nebraska"=2001,# Nebraska left Big 12 after 2010
    "Missouri"=2001,# Missouri left Big 12 after 2011
    "Texas A&M"=2001,# Texas A&M left Big 12 after 2011
    "BYU"=2023,
    "Cincinnati"=2023,"UCF"=2023,"Houston"=2023,
    "Arizona"=2024,"Arizona St"=2024,"Arizona State"=2024,
    "Colorado"=2024,"Utah"=2024
  )
  for (nm in names(b12_year)) {
    if (t == nm) {
      yr_join <- b12_year[[nm]]
      # Handle teams that left
      if (t %in% c("Colorado","Nebraska") && year >= 2011) break  # moved to B1G/Pac-12
      if (t %in% c("Missouri","Texas A&M") && year >= 2012) break  # moved to SEC
      if (t %in% c("Texas","Oklahoma") && year >= 2024) break     # moved to SEC
      if (year >= yr_join) return("Big 12")
      break
    }
  }

  # ── SEC ────────────────────────────────────────────────────
  sec_always <- c(
    "Alabama","Georgia","LSU","Florida","Tennessee","Auburn",
    "Ole Miss","Miss St","Mississippi State","Arkansas",
    "Kentucky","Missouri","South Carolina","Vanderbilt","Texas A&M",
    "Mississippi St"
  )
  if (t %in% sec_always) {
    if (t == "Missouri" && year <= 2011) return("Big 12")
    if (t == "Texas A&M" && year <= 2011) return("Big 12")
    return("SEC")
  }
  if (t %in% c("Texas","Oklahoma") && year >= 2024) return("SEC")

  # ── PAC-10 / PAC-12 (2001–2023) ────────────────────────────
  pac_always_old <- c(
    "Oregon St","Oregon State","UCLA","USC","Arizona","Arizona St",
    "Arizona State","Washington","Washington St","Washington State",
    "California","Cal","Stanford"
  )
  pac_joined_2011 <- c("Utah","Colorado")

  if (t == "Oregon") {
    if (year <= 2023) return("Pac-12")
    return("Big Ten")  # Oregon joined Big Ten 2024
  }
  if (t %in% pac_always_old) {
    if (year >= 2024) {
      if (t %in% c("UCLA","USC")) return("Big Ten")
      if (t %in% c("Arizona","Arizona St","Arizona State","Colorado","Utah")) return("Big 12")
      if (t %in% c("California","Cal","Stanford")) return("ACC")
      return("Pac-12")  # Oregon St, Washington St remain as Pac-12 remnant
    }
    return("Pac-12")
  }
  if (t %in% pac_joined_2011) {
    if (year >= 2011 && year <= 2023) return("Pac-12")
    if (year <= 2010) {
      if (t == "Utah") return("Mountain West")
      if (t == "Colorado") return("Big 12")
    }
    if (year >= 2024) return("Big 12")
  }
  if (t == "Washington" && year <= 2023) return("Pac-12")

  # ── MOUNTAIN WEST ──────────────────────────────────────────
  mw_always <- c(
    "Boise St","Boise State","San Diego St","San Diego State",
    "Fresno St","Fresno State","Utah St","Utah State","UNLV",
    "Wyoming","Nevada","New Mexico","Air Force","Colorado St",
    "Colorado State","San José St","San Jose St","San Jose State",
    "Hawai'i","Hawaii"
  )
  if (t %in% mw_always) return("Mountain West")
  if (t == "BYU" && year <= 2010) return("Mountain West")
  if (t == "TCU" && year <= 2011) return("Mountain West")
  if (t %in% c("Utah","Colorado") && year <= 2010) return("Mountain West")

  # ── BIG EAST football (2001–2012) / AAC (2013+) ────────────
  # AAC teams — use ESPN shortDisplayName variants
  aac_teams <- c(
    "Tulane","Memphis","East Carolina","South Florida","Temple",
    "USF",     # ESPN shortDisplayName for South Florida
    "SMU","Tulsa","Wichita St","Cincinnati","UCF","Houston","Navy",
    "Charlotte","UTSA"
  )
  big_east_fb <- c(
    "Connecticut","UConn","South Florida","USF","Rutgers",
    "Pittsburgh","Pitt","Cincinnati","West Virginia",
    "Louisville","Syracuse","Temple"
  )
  if (t %in% big_east_fb && year <= 2012) return("Big East")
  if (t %in% aac_teams) {
    if (year >= 2013) return("AAC")
    return("Big East")
  }
  if (t == "Tulane") {
    if (year <= 2004) return("C-USA")
    if (year >= 2022) return("AAC")
    return("Independent")  # Tulane was in C-USA then ind briefly
  }
  if (t == "North Texas" && year >= 2013 && year <= 2023) return("C-USA")
  if (t == "North Texas" && year >= 2024) return("AAC")

  # ── SUN BELT ────────────────────────────────────────────────
  sunbelt <- c(
    "Louisiana","App State","Appalachian State","Troy",
    "GA Southern","Georgia So","Georgia Southern",
    "Arkansas St","Arkansas State","South Alabama",
    "James Madison","Old Dominion","GA St","Georgia St","Georgia State",
    "UL Monroe","Southern Miss","Texas St","Texas State",
    "Coastal","Coastal Car","Coastal Carolina",
    "Marshall"   # Marshall joined Sun Belt 2022
  )
  if (t %in% sunbelt) {
    if (t == "Marshall" && year <= 2004) return("MAC")
    if (t == "Marshall" && year >= 2005 && year <= 2021) return("C-USA")
    if (t == "Marshall" && year >= 2022) return("Sun Belt")
    if (t == "Old Dominion" && year <= 2017) return("C-USA")
    if (t == "Old Dominion" && year >= 2018 && year <= 2021) return("C-USA")
    if (t == "Old Dominion" && year >= 2022) return("Sun Belt")
    return("Sun Belt")
  }

  # ── C-USA ──────────────────────────────────────────────────
  cusa <- c(
    "UAB","Western KY","Western Kentucky","MTSU","Middle Tennessee",
    "Middle Tenn","Liberty","New Mexico St","New Mexico State",
    "Sam Houston","Jax State","Jacksonville St","Jacksonville State",
    "FIU","UTEP","Louisiana Tech","La Tech","UTSA","Rice",
    "Kennesaw St","Kennesaw State","FAU","Florida Atlantic",
    "Charlotte","North Texas","Delaware",
    # Historical C-USA
    "Tulane","USM","Southern Miss","East Carolina","UAB","Houston",
    "TCU","SMU","Memphis","Marshall","Cincinnati","Louisville"
  )
  cusa_year <- list(
    "North Texas"=list(join=2013, leave=2023),
    "UTSA"=list(join=2013, leave=9999),
    "Charlotte"=list(join=2015, leave=2023),
    "Marshall"=list(join=2005, leave=2021),
    "Old Dominion"=list(join=2018, leave=2021),
    "Kennesaw St"=list(join=2022, leave=9999),
    "Jax State"=list(join=2022, leave=9999),
    "Jacksonville St"=list(join=2022, leave=9999),
    "Sam Houston"=list(join=2021, leave=9999),
    "Liberty"=list(join=2023, leave=9999),
    "FAU"=list(join=2013, leave=9999),
    "FIU"=list(join=2009, leave=9999),
    "UTEP"=list(join=2005, leave=9999),
    "Louisiana Tech"=list(join=2013, leave=9999),
    "Rice"=list(join=2005, leave=9999),
    "UAB"=list(join=2001, leave=9999),
    "Western KY"=list(join=2009, leave=9999),
    "Western Kentucky"=list(join=2009, leave=9999),
    "MTSU"=list(join=2013, leave=9999),
    "Middle Tennessee"=list(join=2013, leave=9999),
    "New Mexico St"=list(join=2023, leave=9999),
    "New Mexico State"=list(join=2023, leave=9999)
  )
  if (!is.null(cusa_year[[t]])) {
    info <- cusa_year[[t]]
    if (year >= info$join && year <= info$leave) return("C-USA")
  } else if (t %in% cusa) {
    return("C-USA")
  }

  # ── MAC ────────────────────────────────────────────────────
  mac <- c(
    "W Michigan","Western Michigan","C Michigan","Central Michigan",
    "E Michigan","Eastern Michigan","N Illinois","Northern Illinois",
    "Ball State","Ohio","Toledo","Kent State","Kent St",
    "Akron","Bowling Green","Buffalo","Miami OH","Miami (OH)",
    "N Illinois","NIU"
  )
  if (t %in% mac) return("MAC")

  # ── WAC (historical pre-2012) ──────────────────────────────
  wac <- c("Hawaii","Hawai'i","Nevada","Utah St","Utah State",
           "Louisiana Tech","La Tech","Fresno St","Fresno State",
           "San Jose St","San Jose State","UTEP","New Mexico St",
           "New Mexico State","Idaho","Boise St","Boise State")
  if (t %in% wac && year <= 2011) return("WAC")

  # ── INDEPENDENTS (FBS non-power) ──────────────────────────
  fbs_ind <- c("Army","BYU","UMass","Massachusetts","UConn","Connecticut",
               "Liberty","New Mexico St","New Mexico State",
               "Sam Houston","Jacksonville St","Jacksonville State",
               "Kennesaw St","Kennesaw State","Jax State","Austin Peay",
               "N Dakota St","North Dakota St")
  if (t %in% fbs_ind) return("Independent")

  # ── ADDITIONAL ESPN shortDisplayName variants ───────────────
  # These are names ESPN uses that differ from the primary name above

  # ACC variants
  if (t == "UVA")               return("ACC")   # Virginia
  if (t == "VaTech")            return("ACC")   # Virginia Tech
  if (t %in% c("N Carolina","N.C. State","NCState")) return("ACC")

  # AAC / Big East
  if (t == "USF")               return(if (year >= 2013) "AAC" else "Big East")
  if (t == "ECU")               return(if (year >= 2013) "AAC" else "C-USA")
  if (t == "E Carolina")        return(if (year >= 2013) "AAC" else "C-USA")

  # C-USA variants
  if (t == "Mid Tennessee")     return(if (year >= 2013) "C-USA" else "Sun Belt")
  if (t == "MTSU")              return(if (year >= 2013) "C-USA" else "Sun Belt")
  if (t == "W Kentucky")        return(if (year >= 2009) "C-USA" else "Independent")
  if (t == "WKU")               return(if (year >= 2009) "C-USA" else "Independent")
  if (t == "Jax St")            return("C-USA")

  # MAC variants
  if (t %in% c("Cent Michigan","C. Michigan","CMU"))
                                return("MAC")
  if (t %in% c("E Michigan","EMU"))   return("MAC")
  if (t %in% c("W Michigan","WMU"))   return("MAC")
  if (t %in% c("N Illinois","NIU","No. Illinois")) return("MAC")
  if (t == "Bowling Green St")  return("MAC")
  if (t %in% c("Ball St","Ball State")) return("MAC")
  if (t %in% c("Kent St","Kent State")) return("MAC")

  # Mountain West variants
  if (t == "Colorado St")       return("Mountain West")
  if (t == "San Jose St")       return("Mountain West")
  if (t == "Boise St")          return("Mountain West")
  if (t == "Utah St")           return(if (year <= 2011) "WAC" else "Mountain West")
  if (t == "Fresno St")         return(if (year <= 2011) "WAC" else "Mountain West")

  # Sun Belt variants
  if (t %in% c("Coastal Car","Coastal Carolina")) return("Sun Belt")
  if (t %in% c("Ga Southern","GA Southern","Georgia So","Georgia Southern"))
                                return("Sun Belt")
  if (t %in% c("App State","Appalachian St","Appalachian State"))
                                return(if (year >= 2014) "Sun Belt" else "FCS")
  if (t %in% c("Ga St","GA St","Georgia St","Georgia State")) return("Sun Belt")
  if (t %in% c("Ark State","Arkansas St","Arkansas State")) return("Sun Belt")
  if (t %in% c("Tex State","Texas St","Texas State")) return("Sun Belt")

  # Pac-10/Pac-12 — Oregon fallback (in case shortDisplayName varies)
  if (t %in% c("Oregon","Oregon Ducks")) return(if (year >= 2024) "Big Ten" else "Pac-12")
  if (t %in% c("Wash State","Washington St")) return(if (year >= 2024) "Pac-12" else "Pac-12")

  # SEC variants
  if (t == "Miss State")        return("SEC")
  if (t == "Mississippi")       return("SEC")

  # Big 12 variants
  if (t == "Okla State")        return("Big 12")
  if (t == "K-State")           return("Big 12")
  if (t == "Iowa State")        return("Big 12")

  # FCS teams that appear in FBS schedules — assign "FCS" so they
  # show a conference label instead of NA
  fcs_schools <- c(
    "Appalachian St","Appalachian State","App State",
    "JMU","James Madison",
    "N Dakota St","North Dakota St","North Dakota State","NDSU",
    "W Kentucky","WKU",
    "Youngstown St","Youngstown State",
    "UNH","New Hampshire",
    "Portland State","Portland St",
    "Coast Carolina","Coastal Carolina",
    "Villanova",
    "Towson",
    "Wofford","Furman","The Citadel",
    "Delaware",
    "Northeastern",
    "Liberty",
    "SF Austin","Stephen F. Austin","SFA",
    "Ga Southern","Georgia So","Georgia Southern",
    "Montana St","Montana State",
    "Bethune-Cookman","Bethune",
    "Cal Poly",
    "Maine",
    "Nicholls","Nicholls St",
    "SE Louisiana","Southeastern Louisiana",
    "McNeese","McNeese St","McNeese State",
    "Lamar",
    "Sam Houston","Sam Houston St",
    "SC State","South Carolina State",
    "Chattanooga","UTC",
    "Elon",
    "William & Mary",
    "Samford",
    "UT Martin",
    "Austin Peay"
  )
  if (t %in% fcs_schools) return("FCS")

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
  all_dates <- c(
    seq(as.Date(paste0(yr,  "-08-24")), as.Date(paste0(yr,  "-12-07")), by="1 day"),
    seq(as.Date(paste0(yr,  "-12-15")), as.Date(paste0(yr+1,"-01-22")), by="1 day")
  )
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
  conf_vec <- setNames(sapply(elo$team, function(t) get_conf(t, yr)), elo$team)
  out <- build_output(elo, season=yr, conf_map=conf_vec, sos_map=sos)

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
  message("  -> ", nrow(out), " teams | conf (5+ gp): ", covered, "/", total5)
}
message("CFB done.")
