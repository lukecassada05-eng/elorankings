# ================================================================
# R/update_college_baseball.R  —  NCAA D1 Baseball, 2018–current
# Data: ESPN scoreboard API (daily fetching, groups=11)
#
# Conference map accounts for:
#   - 2024+ realignment (Big Ten, Big 12, ACC additions)
#   - Oregon State / Washington State WCC affiliate 2024-25
#   - All MAC teams (often missed in alias maps)
#   - Mid-major conferences: WAC, Southland, OVC, ASUN, Big South, etc.
# ================================================================
suppressPackageStartupMessages({
  library(dplyr); library(readr); library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
SEASONS <- 2018:(CURRENT_YEAR + 1L)
OUT_DIR  <- "docs/CollegeBaseball/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ================================================================
# ALIASES: ESPN shortDisplayName → canonical team name
# ================================================================
ALIASES <- c(
  "Fla. State"="Florida State",
  "Florida St"="Florida State",
  "FSU"="Florida State",
  "NC State"="NC State",
  "N.C. State"="NC State",
  "N Carolina St"="NC State",
  "North Carolina St"="NC State",
  "Georgia Tech"="Georgia Tech",
  "Ga. Tech"="Georgia Tech",
  "GT"="Georgia Tech",
  "Boston College"="Boston College",
  "BC"="Boston College",
  "Virginia Tech"="Virginia Tech",
  "Va. Tech"="Virginia Tech",
  "VT"="Virginia Tech",
  "Pittsburgh"="Pittsburgh",
  "Pitt"="Pittsburgh",
  "Notre Dame"="Notre Dame",
  "ND"="Notre Dame",
  "UNC"="North Carolina",
  "N. Carolina"="North Carolina",
  "UVA"="Virginia",
  "Va."="Virginia",
  "Miami"="Miami",
  "Miami (FL)"="Miami",
  "Ohio St"="Ohio State",
  "Ohio St."="Ohio State",
  "Penn St"="Penn State",
  "Penn St."="Penn State",
  "Michigan St"="Michigan State",
  "Michigan St."="Michigan State",
  "Mich. St."="Michigan State",
  "Oklahoma St"="Oklahoma State",
  "Okla. State"="Oklahoma State",
  "Iowa St"="Iowa State",
  "Iowa St."="Iowa State",
  "Kansas St"="Kansas State",
  "Kansas St."="Kansas State",
  "K-State"="Kansas State",
  "TCU"="TCU",
  "Texas Christian"="TCU",
  "West Virginia"="West Virginia",
  "WVU"="West Virginia",
  "W. Virginia"="West Virginia",
  "W. Va."="West Virginia",
  "Miss St"="Mississippi State",
  "Miss. State"="Mississippi State",
  "Miss. St."="Mississippi State",
  "Mississippi St"="Mississippi State",
  "Ole Miss"="Ole Miss",
  "Texas A&M Aggies"="Texas A&M",
  "S. Carolina"="South Carolina",
  "S Carolina"="South Carolina",
  "Oregon St"="Oregon State",
  "Ore. State"="Oregon State",
  "Oregon St."="Oregon State",
  "Arizona St"="Arizona State",
  "Ariz. St."="Arizona State",
  "Arizona St."="Arizona State",
  "Wash St"="Washington State",
  "Washington St"="Washington State",
  "Wash. State"="Washington State",
  "Wash. St."="Washington State",
  "Washington St."="Washington State",
  "Cal"="California",
  "UC Berkeley"="California",
  "Fresno St"="Fresno State",
  "Fresno St."="Fresno State",
  "Utah St"="Utah State",
  "Utah St."="Utah State",
  "San Jose St"="San Jose State",
  "San José St"="San Jose State",
  "SJSU"="San Jose State",
  "San Diego St"="San Diego State",
  "SDSU"="San Diego State",
  "Boise St"="Boise State",
  "Boise St."="Boise State",
  "Colorado St"="Colorado State",
  "Colo. State"="Colorado State",
  "Hawaii"="Hawai'i",
  "USF"="South Florida",
  "South Fla"="South Florida",
  "South Fla."="South Florida",
  "ECU"="East Carolina",
  "E. Carolina"="East Carolina",
  "E Carolina"="East Carolina",
  "UConn"="UConn",
  "Connecticut"="UConn",
  "App State"="Appalachian State",
  "Appalachian St"="Appalachian State",
  "Ga. Southern"="Georgia Southern",
  "Ga Southern"="Georgia Southern",
  "GA Southern"="Georgia Southern",
  "Georgia So"="Georgia Southern",
  "Ga. State"="Georgia State",
  "GA St"="Georgia State",
  "Ga St"="Georgia State",
  "Georgia St"="Georgia State",
  "Ark State"="Arkansas State",
  "Ark St"="Arkansas State",
  "Arkansas St"="Arkansas State",
  "Tex State"="Texas State",
  "Texas St"="Texas State",
  "Tex St"="Texas State",
  "Coastal Car"="Coastal Carolina",
  "Coastal"="Coastal Carolina",
  "S. Alabama"="South Alabama",
  "South Ala"="South Alabama",
  "Old Dom."="Old Dominion",
  "ODU"="Old Dominion",
  "Southern Miss"="Southern Miss",
  "So. Miss"="Southern Miss",
  "UL Monroe"="UL Monroe",
  "La.-Monroe"="UL Monroe",
  "ULM"="UL Monroe",
  "Louisiana Lafayette"="Louisiana",
  "UL Lafayette"="Louisiana",
  "ULL"="Louisiana",
  "Western Ky"="Western Kentucky",
  "Western Ky."="Western Kentucky",
  "WKU"="Western Kentucky",
  "W. Kentucky"="Western Kentucky",
  "W Kentucky"="Western Kentucky",
  "Western KY"="Western Kentucky",
  "Middle Tenn"="Middle Tennessee",
  "Middle Tenn."="Middle Tennessee",
  "MTSU"="Middle Tennessee",
  "Fla. Atlantic"="Florida Atlantic",
  "FAU"="Florida Atlantic",
  "FIU Panthers"="FIU",
  "Florida Intl"="FIU",
  "Fla. Intl"="FIU",
  "La. Tech"="Louisiana Tech",
  "La Tech"="Louisiana Tech",
  "New Mexico St"="New Mexico State",
  "New Mexico St."="New Mexico State",
  "NMSU"="New Mexico State",
  "Jax State"="Jacksonville State",
  "Jacksonville St"="Jacksonville State",
  "Jax St"="Jacksonville State",
  "Jacksonville St."="Jacksonville State",
  "Kennesaw St"="Kennesaw State",
  "Kenn. State"="Kennesaw State",
  "Sam Hous."="Sam Houston",
  "Sam Houston St"="Sam Houston",
  "SHSU"="Sam Houston",
  "Cent Michigan"="Central Michigan",
  "C. Michigan"="Central Michigan",
  "Central Mich"="Central Michigan",
  "C Michigan"="Central Michigan",
  "CMU"="Central Michigan",
  "E. Michigan"="Eastern Michigan",
  "E Michigan"="Eastern Michigan",
  "Eastern Mich"="Eastern Michigan",
  "EMU"="Eastern Michigan",
  "W. Michigan"="Western Michigan",
  "W Michigan"="Western Michigan",
  "Western Mich"="Western Michigan",
  "WMU"="Western Michigan",
  "N. Illinois"="Northern Illinois",
  "N Illinois"="Northern Illinois",
  "Northern Ill"="Northern Illinois",
  "NIU"="Northern Illinois",
  "No. Illinois"="Northern Illinois",
  "Ball St"="Ball State",
  "Ball St."="Ball State",
  "Bowling Green St"="Bowling Green",
  "BGSU"="Bowling Green",
  "Bowl. Green"="Bowling Green",
  "UB"="Buffalo",
  "Kent St"="Kent State",
  "Kent St."="Kent State",
  "Miami OH"="Miami (OH)",
  "Miami (Ohio)"="Miami (OH)",
  "MiamiOH"="Miami (OH)",
  "Akron"="Akron",
  "Santa Barbara"="UC Santa Barbara",
  "UCSB"="UC Santa Barbara",
  "UC Santa Barbara"="UC Santa Barbara",
  "UC Irvine"="UC Irvine",
  "UCI"="UC Irvine",
  "Long Beach St"="Long Beach State",
  "LBSU"="Long Beach State",
  "CS Fullerton"="Cal State Fullerton",
  "Fullerton"="Cal State Fullerton",
  "Sacramento St"="Sacramento State",
  "Sac. State"="Sacramento State",
  "CS Northridge"="Cal State Northridge",
  "CSUN"="Cal State Northridge",
  "Bakersfield"="Cal State Bakersfield",
  "CS Bakersfield"="Cal State Bakersfield",
  "UC Davis"="UC Davis",
  "UC Riverside"="UC Riverside",
  "UC San Diego"="UC San Diego",
  "Gonzaga"="Gonzaga",
  "BYU"="BYU",
  "Brigham Young"="BYU",
  "St. Mary's"="Saint Mary's",
  "Saint Mary's"="Saint Mary's",
  "Pepperdine"="Pepperdine",
  "LMU"="Loyola Marymount",
  "Loyola Marymount"="Loyola Marymount",
  "San Francisco"="San Francisco",
  "Wash St."="Washington State",
  "Missouri St"="Missouri State",
  "Mo. State"="Missouri State",
  "Indiana St"="Indiana State",
  "Indiana St."="Indiana State",
  "Illinois St"="Illinois State",
  "Illinois St."="Illinois State",
  "S. Illinois"="Southern Illinois",
  "S Illinois"="Southern Illinois",
  "N. Iowa"="Northern Iowa",
  "Northern Iowa"="Northern Iowa",
  "UNI"="Northern Iowa",
  "Evansville"="Evansville",
  "Bradley"="Bradley",
  "Valparaiso"="Valparaiso",
  "Belmont"="Belmont",
  "Wright St"="Wright State",
  "Wright St."="Wright State",
  "N. Kentucky"="Northern Kentucky",
  "N Kentucky"="Northern Kentucky",
  "Oakland"="Oakland",
  "Purdue FW"="Purdue Fort Wayne",
  "Purdue Fort Wayne"="Purdue Fort Wayne",
  "IU Indy"="IU Indianapolis",
  "IUPUI"="IU Indianapolis",
  "Milwaukee"="Milwaukee",
  "Green Bay"="Green Bay",
  "Campbell"="Campbell",
  "High Point"="High Point",
  "Gardner-Webb"="Gardner-Webb",
  "Winthrop"="Winthrop",
  "Longwood"="Longwood",
  "Presbyterian"="Presbyterian",
  "SC Upstate"="SC Upstate",
  "UNC Asheville"="UNC Asheville",
  "Radford"="Radford",
  "Charleston So"="Charleston Southern",
  "Ch. Southern"="Charleston Southern",
  "Charleston"="Charleston",
  "Col. of Charleston"="Charleston",
  "Northeastern"="Northeastern",
  "Delaware"="Delaware",
  "Towson"="Towson",
  "UNC Wilmington"="UNC Wilmington",
  "Elon"="Elon",
  "Hofstra"="Hofstra",
  "Stony Brook"="Stony Brook",
  "William & Mary"="William & Mary",
  "Drexel"="Drexel",
  "Mercer"="Mercer",
  "Samford"="Samford",
  "The Citadel"="The Citadel",
  "Citadel"="The Citadel",
  "Furman"="Furman",
  "Wofford"="Wofford",
  "VMI"="VMI",
  "Chattanooga"="Chattanooga",
  "UTC"="Chattanooga",
  "ETSU"="East Tennessee State",
  "E. Tenn. State"="East Tennessee State",
  "W. Carolina"="Western Carolina",
  "W Carolina"="Western Carolina",
  "UNC Greens."="UNC Greensboro",
  "UNC Greensboro"="UNC Greensboro",
  "Morehead St"="Morehead State",
  "Morehead St."="Morehead State",
  "E. Kentucky"="Eastern Kentucky",
  "E Kentucky"="Eastern Kentucky",
  "Murray St"="Murray State",
  "Murray St."="Murray State",
  "UT Martin"="UT Martin",
  "UTM"="UT Martin",
  "Bellarmine"="Bellarmine",
  "Lipscomb"="Lipscomb",
  "North Alabama"="North Alabama",
  "North Florida"="North Florida",
  "Queens"="Queens",
  "Stetson"="Stetson",
  "Jacksonville"="Jacksonville",
  "FGCU"="Florida Gulf Coast",
  "Florida Gulf Coast"="Florida Gulf Coast",
  "Lindenwood"="Lindenwood",
  "E. Illinois"="Eastern Illinois",
  "E Illinois"="Eastern Illinois",
  "SE Missouri St"="Southeast Missouri",
  "SE Missouri"="Southeast Missouri",
  "SEMO"="Southeast Missouri",
  "CA Baptist"="Cal Baptist",
  "Cal Baptist"="Cal Baptist",
  "GCU"="Grand Canyon",
  "Grand Canyon"="Grand Canyon",
  "Utah Tech"="Utah Tech",
  "Tarleton St"="Tarleton State",
  "SFA"="Stephen F. Austin",
  "SF Austin"="Stephen F. Austin",
  "McNeese St"="McNeese",
  "McNeese State"="McNeese",
  "Nicholls St"="Nicholls",
  "Nicholls State"="Nicholls",
  "SE Louisiana"="SE Louisiana",
  "Southeastern La."="SE Louisiana",
  "N'Western St"="Northwestern State",
  "Northwestern St"="Northwestern State",
  "Lamar"="Lamar",
  "Hou Christian"="Houston Christian",
  "Houston Baptist"="Houston Christian",
  "Abil Christian"="Abilene Christian",
  "Abilene Chrstn"="Abilene Christian",
  "NC A&T"="North Carolina A&T",
  "N.C. A&T"="North Carolina A&T",
  "Delaware St"="Delaware State",
  "Norfolk St"="Norfolk State",
  "Morgan St"="Morgan State",
  "Coppin St"="Coppin State",
  "Alabama A&M"="Alabama A&M",
  "Alabama St"="Alabama State",
  "Bethune"="Bethune-Cookman",
  "Fla. A&M"="Florida A&M",
  "SC State"="South Carolina State",
  "Texas Southern"="Texas Southern",
  "Miss Valley St"="Mississippi Valley State",
  "Grambling"="Grambling",
  "Prairie View"="Prairie View A&M",
  "Jackson St"="Jackson State",
  "AR-Pine Bluff"="Arkansas-Pine Bluff",
  "Alcorn St"="Alcorn State",
  "Savannah St"="Savannah State",
  "NC Central"="NC Central",
  "Colgate"="Colgate",
  "Fordham"="Fordham",
  "Holy Cross"="Holy Cross",
  "Bucknell"="Bucknell",
  "Lafayette"="Lafayette",
  "Lehigh"="Lehigh",
  "Army"="Army",
  "Yale"="Yale",
  "Harvard"="Harvard",
  "Princeton"="Princeton",
  "Dartmouth"="Dartmouth",
  "Columbia"="Columbia",
  "Cornell"="Cornell",
  "Brown"="Brown",
  "Penn"="Penn",
  "Long Island"="Long Island University",
  "LIU"="Long Island University",
  "Wagner"="Wagner",
  "Rider"="Rider",
  "Bryant"="Bryant",
  "Sacred Heart"="Sacred Heart",
  "Fairfield"="Fairfield",
  "Monmouth"="Monmouth",
  "Marist"="Marist",
  "Manhattan"="Manhattan",
  "Canisius"="Canisius",
  "Niagara"="Niagara",
  "Siena"="Siena",
  "Quinnipiac"="Quinnipiac",
  "Albany"="Albany",
  "UAlbany"="Albany",
  "Binghamton"="Binghamton",
  "Maine"="Maine",
  "UMBC"="UMBC",
  "Seton Hall"="Seton Hall",
  "St. John's"="St. John's",
  "Georgetown"="Georgetown",
  "Providence"="Providence",
  "Creighton"="Creighton",
  "Xavier"="Xavier",
  "DePaul"="DePaul",
  "Villanova"="Villanova",
  "Butler"="Butler",
  "Marquette"="Marquette",
  "Rhode Island"="Rhode Island",
  "URI"="Rhode Island",
  "UMass"="Massachusetts",
  "Mass."="Massachusetts",
  "Richmond"="Richmond",
  "Dayton"="Dayton",
  "VCU"="VCU",
  "George Mason"="George Mason",
  "Davidson"="Davidson",
  "Saint Joseph's"="Saint Joseph's",
  "Saint Louis"="Saint Louis",
  "La Salle"="La Salle",
  "Duquesne"="Duquesne",
  "G Washington"="George Washington",
  "GWU"="George Washington",
  "St Bonaventure"="St. Bonaventure",
  "A-Sun"="ASUN",
  "Dallas Baptist"="Dallas Baptist",
  "DBU"="Dallas Baptist",
  "UMass Lowell"="UMass Lowell",
  "Hartford"="Hartford",
  "C. of Charleston"="Charleston",
  "Little Rock"="Little Rock",
  "Ark.-Little Rock"="Little Rock",
  "Ark-Little Rock"="Little Rock",
  "Oral Roberts"="Oral Roberts",
  "ORU"="Oral Roberts",
  "UIC"="Illinois-Chicago",
  "Illinois-Chicago"="Illinois-Chicago",
  "UT Arlington"="UT Arlington",
  "UTA"="UT Arlington",
  "Tex. Arlington"="UT Arlington",
  "New Orleans"="New Orleans",
  "UNO"="New Orleans",
  "SIUE"="SIUE",
  "SIU Edwardsville"="SIUE",
  "SIU-E"="SIUE",
  "Wichita St"="Wichita State",
  "Wichita St."="Wichita State",
  "C Arkansas"="Central Arkansas",
  "Cent. Arkansas"="Central Arkansas",
  "Cent Arkansas"="Central Arkansas",
  "S Dakota St"="South Dakota State",
  "S. Dakota St"="South Dakota State",
  "South Dakota St"="South Dakota State",
  "N Dakota St"="North Dakota State",
  "North Dakota St"="North Dakota State",
  "NDSU"="North Dakota State",
  "So Indiana"="Southern Indiana",
  "UT Rio Grande"="UT Rio Grande Valley",
  "UTRGV"="UT Rio Grande Valley",
  "W Illinois"="Western Illinois",
  "W. Illinois"="Western Illinois",
  "Seattle U"="Seattle",
  "Seattle U."="Seattle",
  "St John's"="St. John's",
  "St. Johns"="St. John's",
  "St Thomas (MN)"="St. Thomas",
  "St. Thomas (MN)"="St. Thomas",
  "Geo Washington"="George Washington",
  "C Connecticut"="Central Connecticut State",
  "Cent. Conn."="Central Connecticut State",
  "FDU"="Fairleigh Dickinson",
  "New Haven"="New Haven",
  "NJIT"="NJIT"
)

# ================================================================
# Conference assignment for college baseball
# NOTE: Baseball conferences ≠ football conferences in many cases!
# Key 2024-25 baseball realignment:
#   - Oregon, UCLA, USC, Washington → Big Ten (baseball follows football)
#   - Oregon State, Washington State → WCC affiliate 2024-25, then new Pac-12
#   - Arizona, Arizona State, Colorado, Utah → Big 12
#   - Cal, Stanford → ACC
#   - Texas, Oklahoma → SEC (2025+)
# ================================================================
get_conf_cbase_static <- function(team, year) {
  t <- trimws(team)
  if (t %in% names(ALIASES)) t <- ALIASES[[t]]

  # ── ACC ───────────────────────────────────────────────────
  acc_stable <- c("Clemson","Miami","NC State","Duke","Virginia","Virginia Tech",
                  "Georgia Tech","Wake Forest","Louisville","Pittsburgh","Syracuse",
                  "Boston College","North Carolina","Florida State","Notre Dame")
  if (t %in% acc_stable) return("ACC")
  # Stanford, Cal joined ACC 2024
  if (t %in% c("Stanford","California") && year >= 2024) return("ACC")
  if (t %in% c("Stanford","California") && year < 2024) return("Pac-12")
  if (t == "SMU" && year >= 2024) return("ACC")
  if (t == "SMU" && year < 2024) return("AAC")

  # ── SEC ───────────────────────────────────────────────────
  sec_stable <- c("Vanderbilt","LSU","Florida","Georgia","Tennessee","South Carolina",
                  "Mississippi State","Ole Miss","Arkansas","Auburn","Alabama","Kentucky",
                  "Missouri","Texas A&M")
  if (t %in% sec_stable) return("SEC")
  if (t == "Texas"    && year >= 2025) return("SEC")
  if (t == "Texas"    && year < 2025)  return("Big 12")
  if (t == "Oklahoma" && year >= 2025) return("SEC")
  if (t == "Oklahoma" && year < 2025)  return("Big 12")

  # ── BIG TEN ───────────────────────────────────────────────
  b10_stable <- c("Michigan","Ohio State","Indiana","Maryland","Rutgers","Nebraska",
                  "Minnesota","Wisconsin","Iowa","Purdue","Illinois","Northwestern",
                  "Penn State","Michigan State")
  if (t %in% b10_stable) return("Big Ten")
  # 2024+ additions (baseball follows football for these)
  if (t %in% c("UCLA","USC","Oregon","Washington") && year >= 2024) return("Big Ten")
  if (t %in% c("UCLA","USC","Oregon","Washington") && year < 2024)  return("Pac-12")

  # ── BIG 12 ────────────────────────────────────────────────
  b12_stable <- c("TCU","Texas Tech","Kansas","Kansas State","Iowa State","Baylor",
                  "Oklahoma State","West Virginia")
  if (t %in% b12_stable) return("Big 12")
  if (t == "Texas" && year < 2025) return("Big 12")
  if (t == "Oklahoma" && year < 2025) return("Big 12")
  if (t %in% c("BYU","Cincinnati","UCF","Houston") && year >= 2023) return("Big 12")
  # 2024+ additions
  if (t %in% c("Arizona","Arizona State","Utah","Colorado") && year >= 2024) return("Big 12")
  if (t %in% c("Arizona","Arizona State") && year < 2024) return("Pac-12")
  if (t %in% c("Utah","Colorado") && year < 2024) return("Pac-12")

  # ── PAC-12 (shrinking 2024+) ──────────────────────────────
  # Oregon State and Washington State: WCC affiliate 2024-25
  if (t == "Oregon State") {
    if (year >= 2024) return("WCC")  # WCC affiliate while Pac-12 restructures
    return("Pac-12")
  }
  if (t == "Washington State") {
    if (year >= 2024) return("WCC")  # WCC affiliate
    return("Pac-12")
  }
  # Other Pac-12 teams pre-2024
  pac12_old <- c("Oregon","Oregon State","UCLA","USC","Arizona","Arizona State",
                 "Washington","Washington State","California","Stanford","Utah","Colorado")
  if (t %in% pac12_old && year < 2024) return("Pac-12")

  # ── MOUNTAIN WEST ─────────────────────────────────────────
  mw_stable <- c("San Diego State","Fresno State","Utah State","UNLV","Wyoming",
                 "Nevada","New Mexico","Air Force","Colorado State","San Jose State",
                 "Hawai'i","Boise State","New Mexico State")
  if (t %in% mw_stable) return("Mountain West")

  # ── AAC ───────────────────────────────────────────────────
  aac_stable <- c("East Carolina","Tulane","South Florida","Memphis","Temple",
                  "Houston","UCF","Cincinnati","Tulsa","Navy","Dallas Baptist",
                  "Charlotte","UTSA","North Texas","Wichita State","Florida Atlantic",
                  "Rice","Old Dominion")
  if (t %in% aac_stable) {
    if (year >= 2013) return("AAC")
    return("C-USA")
  }

  # ── SUN BELT ──────────────────────────────────────────────
  sunbelt_stable <- c("Louisiana","Troy","Appalachian State","Arkansas State",
                      "Georgia Southern","Georgia State","South Alabama","UL Monroe",
                      "Southern Miss","Texas State","Coastal Carolina","Old Dominion",
                      "James Madison","Marshall","Louisiana Tech","Little Rock",
                      "UT Arlington","Georgia State","New Orleans")
  if (t %in% sunbelt_stable) return("Sun Belt")

  # ── C-USA ─────────────────────────────────────────────────
  cusa_stable <- c("UAB","Middle Tennessee","Western Kentucky","Florida Atlantic",
                   "FIU","UTEP","Rice","Kennesaw State","Jacksonville State",
                   "Sam Houston","Liberty","New Mexico State","UTSA","Charlotte",
                   "Dallas Baptist","North Texas","Old Dominion","Louisiana Tech")
  if (t %in% cusa_stable) return("C-USA")

  # ── MAC ───────────────────────────────────────────────────
  mac_stable <- c("Central Michigan","Eastern Michigan","Western Michigan",
                  "Northern Illinois","Ball State","Bowling Green","Buffalo",
                  "Kent State","Miami (OH)","Ohio","Toledo","Akron","Massachusetts")
  if (t %in% mac_stable) {
    if (t == "Massachusetts" && year >= 2025) return("MAC")  # rejoined 2025
    if (t == "Massachusetts" && year >= 2012) return("A-10")
    if (t == "Massachusetts" && year < 2012)  return("MAC")
    return("MAC")
  }

  # ── BIG WEST ──────────────────────────────────────────────
  big_west <- c("Cal Poly","UC Santa Barbara","UC Irvine","UC Davis","UC Riverside",
                "UC San Diego","Cal State Fullerton","Long Beach State","Hawai'i",
                "Sacramento State","Cal State Northridge","Cal State Bakersfield")
  if (t %in% big_west) return("Big West")

  # ── WCC ───────────────────────────────────────────────────
  wcc <- c("Gonzaga","BYU","San Diego","Santa Clara","Pacific","Loyola Marymount",
           "Portland","San Francisco","Saint Mary's","Pepperdine","Oregon State",
           "Washington State","LMU","Seattle","Seattle University")
  if (t %in% wcc) {
    if (t == "BYU" && year >= 2023) return("Big 12")  # BYU baseball moved to Big 12
    if (t == "BYU" && year < 2023)  return("WCC")
    return("WCC")
  }

  # ── MVC ───────────────────────────────────────────────────
  mvc <- c("Missouri State","Indiana State","Illinois State","Southern Illinois",
           "Bradley","Evansville","Northern Iowa","Valparaiso","Belmont",
           "Dallas Baptist","Illinois State")
  if (t %in% mvc) return("MVC")

  # ── HORIZON ───────────────────────────────────────────────
  horizon <- c("Wright State","Milwaukee","Northern Kentucky","Oakland",
               "Purdue Fort Wayne","IU Indianapolis","Green Bay","Cleveland State",
               "Detroit Mercy","Robert Morris","Youngstown State","Illinois-Chicago",
               "UIC","IUPUI")
  if (t %in% horizon) return("Horizon")

  # ── BIG SOUTH / CAA ───────────────────────────────────────
  big_south <- c("Campbell","High Point","Gardner-Webb","Longwood","Presbyterian",
                 "SC Upstate","UNC Asheville","Radford","Winthrop","Charleston Southern")
  if (t %in% big_south) return("Big South")

  caa <- c("Northeastern","Delaware","Towson","UNC Wilmington","Elon","Charleston",
           "Hofstra","Stony Brook","William & Mary","Drexel","Charleston Southern",
           "Col. of Charleston")
  if (t %in% caa) return("CAA")

  # ── SoCon ─────────────────────────────────────────────────
  socon <- c("Mercer","Samford","The Citadel","Western Carolina","Furman","Wofford",
             "VMI","Chattanooga","East Tennessee State","UNC Greensboro")
  if (t %in% socon) return("SoCon")

  # ── ASUN / OVC ────────────────────────────────────────────
  asun_ovc <- c("Morehead State","Eastern Kentucky","Tennessee Tech","Murray State",
                "UT Martin","Southeast Missouri","Austin Peay","Eastern Illinois",
                "Bellarmine","North Alabama","Lipscomb","Jacksonville","Stetson",
                "North Florida","Queens","Florida Gulf Coast","Lindenwood",
                "Illinois-Chicago","SIUE","Southern Indiana","IUPUI",
                "UT Martin","Kennesaw State")
  if (t %in% asun_ovc) return("ASUN/OVC")

  # ── WAC / Southland ───────────────────────────────────────
  wac_south <- c("Sam Houston","Stephen F. Austin","Abilene Christian","Lamar",
                 "McNeese","Nicholls","SE Louisiana","Northwestern State",
                 "Incarnate Word","Houston Christian","Tarleton State","Grand Canyon",
                 "Cal Baptist","Utah Tech","Central Arkansas","UT Rio Grande Valley","New Orleans")
  if (t %in% wac_south) return("WAC/Southland")

  # ── SWAC / MEAC ───────────────────────────────────────────
  swac_meac <- c("Grambling","Prairie View A&M","Southern","Alcorn State",
                 "Jackson State","Texas Southern","Alabama State","Alabama A&M",
                 "Florida A&M","Bethune-Cookman","South Carolina State","Howard",
                 "Morgan State","Delaware State","Norfolk State","North Carolina A&T",
                 "NC Central","Savannah State","Mississippi Valley State",
                 "Arkansas-Pine Bluff","Maryland Eastern Shore","Coppin State")
  if (t %in% swac_meac) return("SWAC/MEAC")

  # ── IVY ───────────────────────────────────────────────────
  ivy <- c("Yale","Harvard","Princeton","Dartmouth","Columbia","Cornell","Brown","Penn")
  if (t %in% ivy) return("Ivy League")

  # ── PATRIOT ───────────────────────────────────────────────
  patriot <- c("Colgate","Fordham","Holy Cross","Bucknell","Lafayette","Lehigh","Army","Navy")
  if (t %in% patriot) return("Patriot")

  # ── MAAC ──────────────────────────────────────────────────
  maac <- c("Fairfield","Manhattan","Rider","Canisius","Niagara","Siena","Quinnipiac",
            "Marist","Monmouth","Iona","Mount St. Mary's","Sacred Heart","Bryant")
  if (t %in% maac) return("MAAC")

  # ── A-10 ──────────────────────────────────────────────────
  a10 <- c("VCU","Dayton","George Mason","Richmond","Davidson","Fordham","La Salle",
           "Saint Joseph's","Saint Louis","George Washington","Duquesne","Massachusetts",
           "Rhode Island","UMass","St. Bonaventure","George Washington University")
  if (t %in% a10) {
    if (t == "Massachusetts" && year >= 2025) return("MAC")  # rejoined MAC
    return("A-10")
  }

  # ── BIG EAST ──────────────────────────────────────────────
  big_east <- c("Georgetown","Providence","Creighton","Xavier","DePaul","Villanova",
                "Butler","Marquette","UConn","Seton Hall","St. John's",
                "St. John's University","St. Johns")
  if (t %in% big_east) return("Big East")

  # ── AMERICA EAST ──────────────────────────────────────────
  ae <- c("Albany","Binghamton","Maine","UMBC","Stony Brook","Vermont",
          "New Hampshire","Hartford","UMass Lowell")
  if (t %in% ae) return("America East")

  # ── SUMMIT LEAGUE ─────────────────────────────────────────
  summit <- c("South Dakota State","North Dakota State","Oral Roberts","Omaha",
              "Denver","Western Illinois","Kansas City","South Dakota",
              "St. Thomas","IUPUI","North Dakota","UMKC",
              "Kansas City Roos","Oral Roberts University")
  if (t %in% summit) return("Summit")

  # ── NEC ───────────────────────────────────────────────────
  nec <- c("Wagner","Long Island University","Sacred Heart","Bryant","Merrimack",
           "St. Francis","Fairleigh Dickinson","Central Connecticut State",
           "Mount St. Mary's","Le Moyne","New Haven")
  if (t %in% nec) return("NEC")

  return("Other D1")
}

# ================================================================
# Conference assignment — auto-detected from ESPN's standings feed
# ================================================================
# Same approach as CFB's fetch_cfb_conf_map(): read ESPN's own
# conference standings groups for the season, so realignment shows up
# automatically with no code change. This is a COMPLETELY SEPARATE
# lookup from CFB's — a school's baseball conference can differ from
# its football conference (the note above this function documents
# several such cases), so nothing here is shared with, or derived
# from, any other sport's script.
#
# Only used for the current/upcoming season — historical seasons stay
# on the static table above, so a parsing miss can't corrupt past data.
fetch_cbase_conf_map <- function(season) {
  url <- paste0(
    "https://site.api.espn.com/apis/v2/sports/baseball/college-baseball/standings",
    "?season=", season, "&level=1"
  )
  data <- tryCatch(jsonlite::fromJSON(url, simplifyVector = FALSE), error = function(e) NULL)
  if (is.null(data)) return(character(0))

  candidates <- list(data$children, data$standings$groups, data$groups)
  groups <- Find(function(g) length(g) > 0, candidates)
  if (is.null(groups)) return(character(0))

  out <- character(0)
  for (g in groups) {
    conf_name <- tryCatch(
      g$name %||% g$shortName %||% g$abbreviation, error = function(e) NULL
    )
    if (is.null(conf_name) || !nchar(conf_name)) next
    entries <- tryCatch(g$standings$entries, error = function(e) NULL)
    if (is.null(entries)) entries <- tryCatch(g$entries, error = function(e) NULL)
    if (is.null(entries)) next
    for (e in entries) {
      team_name <- tryCatch(
        e$team$shortDisplayName %||% e$team$displayName %||% e$team$name,
        error = function(e2) NULL
      )
      if (!is.null(team_name) && nchar(team_name) > 0) out[[team_name]] <- conf_name
    }
  }
  out
}

# ── Dispatcher: live lookup first, static table as fallback ────
get_conf_cbase <- function(team, year, live_map = NULL) {
  t <- trimws(team)
  if (t %in% names(ALIASES)) t <- ALIASES[[t]]
  if (!is.null(live_map) && t %in% names(live_map)) return(live_map[[t]])
  get_conf_cbase_static(t, year)
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

# ── Fetch full season via date-range requests ─────────────────
# Use jsonlite::fromJSON(url) with date ranges — much faster than day-by-day
# ESPN scoreboard accepts ?dates=YYYYMMDD-YYYYMMDD for multi-day ranges
fetch_cbase_season <- function(yr) {
  message("  ESPN: College Baseball ", yr)
  season_start <- as.Date(paste0(yr, "-02-14"))
  season_end   <- min(as.Date(paste0(yr, "-06-30")), Sys.Date())
  if (season_start > Sys.Date()) {
    message("  Season hasn't started yet — skipping")
    return(NULL)
  }

  # Fetch in ~2-week chunks to stay under ESPN limits
  chunk_starts <- seq(season_start, season_end, by = "14 days")
  all_games <- list()

  for (d in as.character(chunk_starts)) {
    d_end <- min(as.Date(d) + 13, season_end)
    ds    <- gsub("-","", d)
    de    <- gsub("-","", as.character(d_end))

    # Fetch BOTH: groups=11 (D1 vs D1) AND no-groups (all opponents)
    # Combining both captures more games for lesser programs vs D2/D3 opponents
    chunk_rows <- list()
    for (url_str in c(
      paste0("https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard",
             "?limit=1000&groups=11&dates=", ds, "-", de),
      paste0("https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard",
             "?limit=1000&dates=", ds, "-", de)
    )) {
      data <- tryCatch(
        jsonlite::fromJSON(url_str, simplifyVector=FALSE),
        error=function(e) NULL
      )
      if (!is.null(data) && length(data$events) > 0) {
        rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
        if (length(rows) > 0) {
          chunk_rows <- c(chunk_rows, list(data.frame(
            winner     = sapply(rows, `[[`, "winner"),
            loser      = sapply(rows, `[[`, "loser"),
            winner_pts = as.numeric(sapply(rows, `[[`, "winner_pts")),
            loser_pts  = as.numeric(sapply(rows, `[[`, "loser_pts")),
            stringsAsFactors = FALSE
          )))
        }
      }
      Sys.sleep(0.1)
    }
    if (length(chunk_rows) > 0) all_games <- c(all_games, chunk_rows)
    Sys.sleep(0.15)
  }

  if (!length(all_games)) return(NULL)

  games <- unique(do.call(rbind, all_games))
  games <- games[!is.na(games$winner) & games$winner != "" &
                 !is.na(games$loser)  & games$loser  != "" &
                 games$winner != games$loser, ]
  games$winner_pts <- pmin(games$winner_pts, games$loser_pts + 12)

  message("  Total: ", nrow(games), " unique games in ", yr)
  games
}

# ── Per-season Elo ─────────────────────────────────────────────
for (yr in SEASONS) {
  message("College Baseball ", yr, "...")
  g <- fetch_cbase_season(yr)
  if (is.null(g) || nrow(g) < 50) {
    message("  Skipping — ", if(is.null(g)) 0 else nrow(g), " games"); next
  }

  elo <- run_elo(g, k = 30, iters = 10, min_games = 3)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)

  live_conf_map <- if (yr >= CURRENT_YEAR) fetch_cbase_conf_map(yr) else character(0)
  message("  Live conference map (", yr, "): ", length(live_conf_map), " teams",
          if (yr >= CURRENT_YEAR && !length(live_conf_map)) " — falling back to static table" else "")

  conf_vec <- setNames(
    sapply(elo$team, function(t) get_conf_cbase(t, yr, live_conf_map)),
    elo$team
  )
  # ── Conference tournament champion detection ─────────────
  # BUG FIX: same argument-position bug as update_cbb.R — "&groups=11"
  # was landing in fetch_conf_champs()'s date_from parameter instead of
  # groups_param, mangling the request URL so conf_champ never populated.
  champs_raw <- tryCatch(
    fetch_conf_champs("baseball/college-baseball", yr, groups_param = "&groups=11"),
    error = function(e) character(0)
  )
  conf_champ_map <- NULL
  if (length(champs_raw) > 0) {
    all_teams <- elo$team
    champ_teams <- character(0)
    for (team in champs_raw) {
      team_can <- ALIASES[team] %||% team
      if (team_can %in% all_teams) {
        champ_teams <- c(champ_teams, team_can)
      } else {
        matched <- agrep(team_can, all_teams, ignore.case=TRUE, value=TRUE, max.distance=0.15)
        if (length(matched) > 0) champ_teams <- c(champ_teams, matched[1])
      }
    }
    if (length(champ_teams) > 0) {
      conf_champ_map <- setNames(rep(FALSE, length(all_teams)), all_teams)
      conf_champ_map[champ_teams] <- TRUE
      message("  Conf champs: ", paste(champ_teams, collapse=", "))
    }
  }

  out <- build_output(elo, season=yr, conf_map=conf_vec, sos_map=sos,
                      conf_champ_map=conf_champ_map)
  out <- as.data.frame(lapply(out, function(x) {
    if (is.list(x)) sapply(x, function(v) if (is.null(v)) NA else as.character(v))
    else x
  }), stringsAsFactors=FALSE)

  out_path <- file.path(OUT_DIR, paste0("CBASE_Elo_", yr, ".csv"))
  out <- attach_movers(out, out_path)

  write_csv(out, out_path)

  covered <- sum(!is.na(out$conference) & out$conference != "Other D1" &
                 out$games_played >= 5)
  total5  <- sum(out$games_played >= 5)
  champ_n <- if (!is.null(conf_champ_map)) sum(out$conf_champ, na.rm=TRUE) else 0
  message("  -> ", nrow(out), " teams | conf coverage (5+ gp): ", covered, "/", total5,
          " | champs: ", champ_n)
}

# ================================================================
# NCAA Tournament bracket fetch (runs May-June each year)
# Fetches completed regional/super regional/CWS games from ESPN
# Writes docs/CollegeBaseball/data/tournament_YEAR.json
# JS reads this to show live bracket status + simulate remaining games
# ================================================================
fetch_tournament_results <- function(yr) {
  message("Fetching NCAA tournament results for ", yr, "...")
  
  # Tournament runs May-June — only run during that window
  today <- Sys.Date()
  tourney_start <- as.Date(paste0(yr, "-05-25"))
  tourney_end   <- as.Date(paste0(yr, "-06-30"))
  if (today < tourney_start || today > tourney_end) {
    message("  Outside tournament window — skipping")
    return(NULL)
  }
  
  # Fetch all seasontype=3 (postseason) games for the year
  ds <- gsub("-", "", as.character(tourney_start))
  de <- gsub("-", "", as.character(min(today, tourney_end)))
  
  url <- paste0(
    "https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard",
    "?groups=11&seasontype=3&limit=500&dates=", ds, "-", de
  )
  
  data <- tryCatch(
    jsonlite::fromJSON(url, simplifyVector = FALSE),
    error = function(e) { message("  API error: ", e$message); NULL }
  )
  
  if (is.null(data) || length(data$events) == 0) {
    message("  No tournament games found yet")
    return(list(games = list(), updated = format(Sys.time(), "%Y-%m-%d %H:%M UTC")))
  }
  
  # Parse completed games
  games <- list()
  for (ev in data$events) {
    tryCatch({
      comp  <- ev$competitions[[1]]
      if (!isTRUE(comp$status$type$completed)) next
      comps <- comp$competitors
      if (length(comps) != 2) next
      
      scores <- sapply(comps, function(c) suppressWarnings(as.numeric(c$score)))
      names  <- sapply(comps, function(c) c$team$shortDisplayName)
      
      if (any(is.na(scores)) || scores[1] == scores[2]) next
      
      winner_idx <- which.max(scores)
      loser_idx  <- 3 - winner_idx
      
      # Determine round from notes/name
      round_name <- tryCatch(ev$name, error=function(e) "Regional")
      
      games <- c(games, list(list(
        winner = names[winner_idx],
        loser  = names[loser_idx],
        winner_score = scores[winner_idx],
        loser_score  = scores[loser_idx],
        round  = round_name,
        date   = tryCatch(comp$date, error=function(e) "")
      )))
    }, error = function(e) NULL)
  }
  
  message("  Found ", length(games), " completed tournament games")
  list(games = games, updated = format(Sys.time(), "%Y-%m-%d %H:%M UTC"))
}

# Run tournament fetch for current year
CURRENT_YEAR_INT <- as.integer(format(Sys.Date(), "%Y"))
tourney_data <- fetch_tournament_results(CURRENT_YEAR_INT)
if (!is.null(tourney_data)) {
  out_file <- file.path(OUT_DIR, paste0("tournament_", CURRENT_YEAR_INT, ".json"))
  jsonlite::write_json(tourney_data, out_file, auto_unbox = TRUE, pretty = TRUE)
  message("Tournament JSON written: ", out_file)
}
message("College Baseball done.")

