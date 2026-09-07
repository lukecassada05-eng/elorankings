# ================================================================
# R/cfb_aliases.R — shared ESPN shortDisplayName -> canonical name
# alias table for CFB. Extracted from update_cfb.R so it can be
# sourced by both update_cfb.R and update_cfb_playoff.R without
# duplicating ~350 lines by hand (and without re-running the main
# pipeline, which sourcing update_cfb.R itself would do).
# ================================================================
ALIASES <- c(
  # Florida State
  "Florida State"="Florida St","Fla. State"="Florida St","Fla St"="Florida St","FSU"="Florida St",
  # NC State
  "N.C. State"="NC State","North Carolina St"="NC State","N Carolina St"="NC State","NC St"="NC State",
  # North Carolina
  "N. Carolina"="North Carolina","UNC"="North Carolina","No. Carolina"="North Carolina",
  # Virginia
  "UVA"="Virginia","Va."="Virginia",
  # Virginia Tech
  "Va. Tech"="Virginia Tech","VaTech"="Virginia Tech","VT"="Virginia Tech",
  # Georgia Tech
  "Ga. Tech"="Georgia Tech","GT"="Georgia Tech",
  # Boston College
  "BC"="Boston College","Boston Col"="Boston College",
  # Pittsburgh
  "Pitt"="Pittsburgh",
  # Miami
  "Miami (FL)"="Miami","Miami FL"="Miami",
  # Ohio State
  "Ohio St"="Ohio State","Ohio St."="Ohio State",
  # Penn State
  "Penn St"="Penn State","Penn St."="Penn State",
  # Michigan State
  "Michigan St"="Michigan State","Michigan St."="Michigan State",
  # Oklahoma State
  "Oklahoma St"="Oklahoma State","Oklahoma St."="Oklahoma State","Okla. State"="Oklahoma State","Okla St"="Oklahoma State",
  # Iowa State
  "Iowa St"="Iowa State","Iowa St."="Iowa State",
  # Kansas State
  "Kansas St"="Kansas State","Kansas St."="Kansas State","K-State"="Kansas State","Kan. State"="Kansas State",
  # West Virginia
  "W. Virginia"="West Virginia","W Virginia"="West Virginia","WVU"="West Virginia","W. Va."="West Virginia",
  # Texas A&M
  "Texas A&M Aggies"="Texas A&M","TA&M"="Texas A&M",
  # Mississippi State
  "Mississippi St"="Miss St","Mississippi St."="Miss St","Miss State"="Miss St","Miss. State"="Miss St",
  "Miss. St."="Miss St","Mississippi State"="Miss St",
  # Ole Miss
  "Mississippi"="Ole Miss","Mississippi Rebels"="Ole Miss",
  # South Carolina
  "S. Carolina"="South Carolina","S Carolina"="South Carolina",
  # Oregon State
  "Oregon St"="Oregon State","Oregon St."="Oregon State",
  # Washington State
  "Washington St"="Washington State","Washington St."="Washington State",
  "Wash. State"="Washington State","Wash St"="Washington State",
  # Arizona State
  "Arizona St"="Arizona State","Arizona St."="Arizona State","Ariz. State"="Arizona State","Ariz St"="Arizona State",
  # California
  "Cal"="California","UC Berkeley"="California","California Bears"="California",
  # Boise State
  "Boise St"="Boise State","Boise St."="Boise State",
  # Colorado State
  "Colorado St"="Colorado State","Colorado St."="Colorado State","Colo. State"="Colorado State","Colo St"="Colorado State",
  # Fresno State
  "Fresno St"="Fresno State","Fresno St."="Fresno State",
  # Utah State
  "Utah St"="Utah State","Utah St."="Utah State",
  # San Jose State
  "San Jose St"="San Jose State","San José St"="San Jose State","San Jose St."="San Jose State","SJSU"="San Jose State",
  "San José State"="San Jose State",
  # San Diego State
  "San Diego St"="San Diego State","San Diego St."="San Diego State","SDSU"="San Diego State",
  # Hawai'i
  "Hawaii"="Hawai'i","Haw."="Hawai'i",
  # UNLV
  "Nevada-Las Vegas"="UNLV",
  # New Mexico
  "N. Mexico"="New Mexico","NM"="New Mexico",
  # South Florida
  "S. Florida"="South Florida","South Fla"="South Florida","South Fla."="South Florida",
  "USF"="South Florida","S Fla"="South Florida","South Fla."="South Florida",
  # East Carolina
  "E. Carolina"="East Carolina","ECU"="East Carolina","E Carolina"="East Carolina",
  "E. Car."="East Carolina",
  # UConn
  "Connecticut"="UConn","Conn."="UConn",
  # UCF
  "Central Florida"="UCF","Cent. Florida"="UCF",
  # SMU
  "Southern Methodist"="SMU",
  # Louisiana (UL Lafayette)
  "Louisiana Lafayette"="Louisiana","UL Lafayette"="Louisiana","ULL"="Louisiana",
  "Louisiana-Lafayette"="Louisiana","UL"="Louisiana",
  # UL Monroe
  "Louisiana Monroe"="UL Monroe","Louisiana-Monroe"="UL Monroe","La.-Monroe"="UL Monroe","ULM"="UL Monroe",
  # Appalachian State
  "Appalachian St"="App State","Appalachian State"="App State","App St"="App State","Appy State"="App State",
  # Arkansas State
  "Arkansas St"="Arkansas State","Arkansas St."="Arkansas State","Ark. State"="Arkansas State","Ark St"="Arkansas State",
  # Georgia Southern
  "Ga. Southern"="Georgia Southern","Ga Southern"="Georgia Southern",
  "GA Southern"="Georgia Southern","Georgia So"="Georgia Southern",
  # Georgia State
  "Ga. State"="Georgia State","Ga State"="Georgia State","GA State"="Georgia State",
  "GA St"="Georgia State","Ga St"="Georgia State",
  # South Alabama
  "S. Alabama"="South Alabama","S Alabama"="South Alabama",
  "South Ala"="South Alabama","South Ala."="South Alabama","South Ala"="South Alabama",
  # Texas State
  "Texas St"="Texas State","Texas St."="Texas State","Tex. State"="Texas State","Tex St"="Texas State",
  # Coastal Carolina
  "Coastal Car"="Coastal Carolina","Coast. Carolina"="Coastal Carolina","Coastal Car."="Coastal Carolina",
  # Southern Miss
  "Southern Mississippi"="Southern Miss","S. Mississippi"="Southern Miss","Southern Miss."="Southern Miss",
  # Old Dominion
  "Old Dom."="Old Dominion","ODU"="Old Dominion",
  # James Madison
  "JMU"="James Madison","James Mad."="James Madison",
  # Middle Tennessee
  "Middle Tenn"="Middle Tennessee","Middle Tenn."="Middle Tennessee",
  "MTSU"="Middle Tennessee","Mid Tenn"="Middle Tennessee","Mid Tennessee"="Middle Tennessee",
  # Western Kentucky
  "Western Ky"="Western Kentucky","Western Ky."="Western Kentucky",
  "W. Kentucky"="Western Kentucky","WKU"="Western Kentucky","W Kentucky"="Western Kentucky",
  # Florida Atlantic
  "Fla. Atlantic"="Florida Atlantic","FAU"="Florida Atlantic",
  "Fla Atlantic"="Florida Atlantic","Fla. Atl."="Florida Atlantic",
  # FIU
  "Florida International"="FIU","Fla. International"="FIU",
  # Louisiana Tech
  "La. Tech"="Louisiana Tech","La Tech"="Louisiana Tech","Louisiana Tech."="Louisiana Tech",
  # New Mexico State
  "New Mexico St"="New Mexico State","New Mexico St."="New Mexico State",
  "NMSU"="New Mexico State","NM State"="New Mexico State",
  # Jacksonville State
  "Jacksonville St"="Jacksonville State","Jacksonville St."="Jacksonville State",
  "Jax State"="Jacksonville State","Jax St"="Jacksonville State",
  # Kennesaw State
  "Kennesaw St"="Kennesaw State","KSU"="Kennesaw State","Kennesaw St."="Kennesaw State",
  # Sam Houston
  "Sam Houston State"="Sam Houston","Sam Houston St"="Sam Houston","SHSU"="Sam Houston",
  # Central Michigan
  "Cent. Michigan"="Central Michigan","C. Michigan"="Central Michigan",
  "Central Mich"="Central Michigan","Central Mich."="Central Michigan",
  "Cent Michigan"="Central Michigan","CMU"="Central Michigan",
  # Eastern Michigan
  "E. Michigan"="Eastern Michigan","E Michigan"="Eastern Michigan",
  "Eastern Mich"="Eastern Michigan","Eastern Mich."="Eastern Michigan","EMU"="Eastern Michigan",
  # Western Michigan
  "W. Michigan"="Western Michigan","W Michigan"="Western Michigan",
  "Western Mich"="Western Michigan","Western Mich."="Western Michigan","WMU"="Western Michigan",
  # Northern Illinois
  "N. Illinois"="Northern Illinois","N Illinois"="Northern Illinois",
  "Northern Ill"="Northern Illinois","Northern Ill."="Northern Illinois",
  "NIU"="Northern Illinois","No. Illinois"="Northern Illinois",
  # Ball State
  "Ball St"="Ball State","Ball St."="Ball State",
  # Bowling Green
  "Bowling Green St"="Bowling Green","BGSU"="Bowling Green","Bowl. Green"="Bowling Green",
  # Buffalo
  "UB"="Buffalo",
  # Kent State
  "Kent St"="Kent State","Kent St."="Kent State",
  # Miami (OH)
  "Miami OH"="Miami (OH)","Miami (Ohio)"="Miami (OH)","MiamiOH"="Miami (OH)",
  # Massachusetts
  "UMass"="Massachusetts","Mass."="Massachusetts","Massachusetts"="Massachusetts",
  # Tulsa
  "Golden Hurricane"="Tulsa",
  # Troy State historical
  "Troy State"="Troy","Troy St"="Troy",
  # Navy
  "Navy Midshipmen"="Navy",
  # Temple
  "Owls"="Temple",
  # Charlotte
  "UNCC"="Charlotte",
  # UAB
  "Alabama-Birmingham"="UAB",
  # UTSA
  "UT San Antonio"="UTSA",
  # UTEP
  "Texas-El Paso"="UTEP","UT El Paso"="UTEP",
  # Rice
  "Rice Owls"="Rice",
  # Louisiana Monroe name changes
  "Northeastern Louisiana"="UL Monroe","NE Louisiana"="UL Monroe",
  # Historical name changes
  "Southwest Texas St"="Texas State","Southwest Texas"="Texas State",
  # Indiana State = FCS (Missouri Valley Conference) — NOT aliased to Indiana
  # BYU
  "Brigham Young"="BYU",
  # Notre Dame variants
  "Notre Dame Fighting Irish"="Notre Dame","ND"="Notre Dame",
  # Short ESPN variants not yet covered
  "Mich. St."="Michigan State","Mich St"="Michigan State",
  "LA Tech"="Louisiana Tech","La Tech"="Louisiana Tech",
  "C. Carolina"="Coastal Carolina","Coastal"="Coastal Carolina",
  "OSU"="Ohio State",
  "S Illinois"="Southern Illinois","S. Illinois"="Southern Illinois",
  "S Dakota St"="South Dakota State","S. Dakota St"="South Dakota State",
  "Georgia St"="Georgia State","Ga. St."="Georgia State",
  "Western KY"="Western Kentucky","Western Ky."="Western Kentucky",
  "C Michigan"="Central Michigan","C. Michigan"="Central Michigan",
  "Missouri St"="Missouri State","Mo. State"="Missouri State",
  "Montana St"="Montana State","Mont. State"="Montana State",
  "Idaho St"="Idaho State","Id. State"="Idaho State",
  "N Colorado"="Northern Colorado","No. Colorado"="Northern Colorado",
  "NC A&T"="North Carolina A&T","N.C. A&T"="North Carolina A&T",
  "N\'Western St"="Northwestern State","N. Western St"="Northwestern State",
  "PV A&M"="Prairie View A&M","Prairie View"="Prairie View A&M",
  "S Carolina St"="South Carolina State","SC State"="South Carolina State",
  "Sacramento St"="Sacramento State","Sac. State"="Sacramento State",
  "Tennessee St"="Tennessee State","Tenn. St."="Tennessee State",
  "E Washington"="Eastern Washington","E. Washington"="Eastern Washington",
  "URI"="Rhode Island","R. Island"="Rhode Island",
  "Alcorn St"="Alcorn State","Alc. State"="Alcorn State",
  "C Connecticut"="Central Connecticut State","C. Connecticut"="Central Connecticut State",
  "Indiana St"="Indiana State","Ind. State"="Indiana State",
  "Weber St"="Weber State","Web. State"="Weber State",
  "Illinois St"="Illinois State","Ill. State"="Illinois State",
  "Delaware St"="Delaware State","Del. State"="Delaware State",
  "Norfolk St"="Norfolk State","Norf. State"="Norfolk State",
  "AR-Pine Bluff"="Arkansas-Pine Bluff","Ark-Pine Bluff"="Arkansas-Pine Bluff",
  "Houston Baptist"="Houston Christian","Hou. Baptist"="Houston Christian",
  "Hou Christian"="Houston Christian","Hou. Christian"="Houston Christian",
  "Abilene Chrstn"="Abilene Christian","Abil Christian"="Abilene Christian",
  "Abil. Christian"="Abilene Christian",
  "C Arkansas"="Central Arkansas","Cent. Arkansas"="Central Arkansas",
  "Cent Arkansas"="Central Arkansas","Cen. Arkansas"="Central Arkansas",
  "SE Missouri St"="Southeast Missouri","SE Mo. St."="Southeast Missouri",
  "ETSU"="East Tennessee State","E. Tenn. State"="East Tennessee State",
  "N Arizona"="Northern Arizona","No. Arizona"="Northern Arizona",
  "W Carolina"="Western Carolina","W. Carolina"="Western Carolina",
  "W Illinois"="Western Illinois","W. Illinois"="Western Illinois",
  "W. Ill."="Western Illinois",
  "Morgan St"="Morgan State","Morg. State"="Morgan State",
  "Long Island"="Long Island University","LIU"="Long Island University",
  "Utah Tech"="Utah Tech",
  "Tarleton St"="Tarleton State","Trl. State"="Tarleton State",
  "Sacred Heart"="Sacred Heart",
  "Charleston So"="Charleston Southern","Ch. Southern"="Charleston Southern",
  "Miss Valley St"="Mississippi Valley State","Miss. Valley"="Mississippi Valley State",
  "Portland St"="Portland State","Port. State"="Portland State",
  "Saint Francis"="Saint Francis (PA)",
  "N\'Western St"="Northwestern State",
  "Stony Brook"="Stony Brook",
  "Gardner-Webb"="Gardner-Webb",
  "Lindenwood"="Lindenwood",
  "Merrimack"="Merrimack",
  "East Texas A&M"="East Texas A&M",
  "Kennesaw St"="Kennesaw State",
  "Southern Utah"="Southern Utah",
  "Hampton"="Hampton",
  "Savannah State"="Savannah State","Sav. State"="Savannah State",
  "Drake"="Drake","Drake Bulldogs"="Drake",
  "NC Central"="NC Central","N.C. Central"="NC Central",
  "Hofstra"="Hofstra",
  "Rhode Island"="Rhode Island",
  "SE Missouri"="Southeast Missouri",
  "South Dakota State"="South Dakota State",
  "South Dakota St"="South Dakota State",
  "Missouri State"="Missouri State",
  "Illinois State"="Illinois State",
  "Weber State"="Weber State",
  "Idaho State"="Idaho State",
  "Montana State"="Montana State",
  "Northern Arizona"="Northern Arizona",
  "Northern Colorado"="Northern Colorado",
  "UC Davis"="UC Davis",
  "URI"="Rhode Island",
  # FCS teams that appear in FBS schedules
  "UNH"="New Hampshire",
  "Youngstown St"="Youngstown State",
  "Coast Carolina"="Coastal Carolina",
  "SF Austin"="Stephen F. Austin","SFA"="Stephen F. Austin",
  "N Dakota St"="North Dakota State","North Dakota St"="North Dakota State","NDSU"="North Dakota State",
  "Ark State"="Arkansas State","Ark St"="Arkansas State",
  "Tex State"="Texas State","Tex St"="Texas State",
  "Northeastern"="Northeastern",
  # Additional ESPN variants found in data
  "Bowling Green St"="Bowling Green","BGSU"="Bowling Green",
  "UB"="Buffalo","Buff."="Buffalo",
  "UAB Blazers"="UAB",
  "FIU Panthers"="FIU",
  "USF Bulls"="South Florida",
  "Ga. Tech"="Georgia Tech",
  "Va. Tech"="Virginia Tech",
  "Ohio Bobcats"="Ohio",
  "Miami Redhawks"="Miami (OH)",
  "Mid-American"="Ohio",
  "W. Va."="West Virginia",
  "Fla. Intl"="FIU","Florida Intl"="FIU",
  "S. Alabama"="South Alabama",
  "La.-Monroe"="UL Monroe",
  "UL"="Louisiana",
  "Abil. Christian"="Abilene Christian",
  "Abilene Chrstn"="Abilene Christian",
  "Incarnate Word"="Incarnate Word",
  "Hou Christian"="Houston Christian",
  "UT Martin"="UT Martin",
  "SE Missouri"="Southeast Missouri","SEMO"="Southeast Missouri",
  "SE Louisiana"="SE Louisiana",
  "Nicholls St"="Nicholls","Nicholls State"="Nicholls",
  "McNeese St"="McNeese","McNeese State"="McNeese",
  "Gram."="Grambling","Grambling St"="Grambling",
  "Prairie View"="Prairie View",
  "Fla. A&M"="Florida A&M",
  "Bethune"="Bethune-Cookman",
  "N. Alabama"="North Alabama",
  "Jax St"="Jacksonville State",
  "Kenn. State"="Kennesaw State",
  "Sam Hous."="Sam Houston",
  "N'Western St"="Northwestern State",
  "NW State"="Northwestern State",
  "Southeastern"="Southeastern Louisiana",
  "E Texas A&M"="East Texas A&M",
  "Texas Southern"="Texas Southern",
  "SC State"="South Carolina State",
  "Alc. State"="Alcorn State","Alcorn St"="Alcorn State",
  "Jackson St"="Jackson State",
  "Tx Southern"="Texas Southern",
  "Morehead St"="Morehead State",
  "E. Kentucky"="Eastern Kentucky","E Kentucky"="Eastern Kentucky",
  "E. Illinois"="Eastern Illinois","E Illinois"="Eastern Illinois",
  "Murray St"="Murray State",
  "UT-Martin"="UT Martin",
  "Tenn. State"="Tennessee State","Tenn State"="Tennessee State",
  "Tenn. Tech"="Tennessee Tech","Tenn Tech"="Tennessee Tech",
  "Chat."="Chattanooga",
  "W. Carolina"="Western Carolina","W Carolina"="Western Carolina",
  "VMI Keydets"="VMI",
  "The Citadel"="The Citadel",
  "Furman Paladins"="Furman",
  "Wofford Terriers"="Wofford",
  "Samford Bulldogs"="Samford",
  "Mercer Bears"="Mercer",
  "Elon Phoenix"="Elon",
  "Campbell Camels"="Campbell",
  "NC A&T"="North Carolina A&T","N.C. A&T"="North Carolina A&T",
  "Monmouth Hawks"="Monmouth",
  "Bryant Bulldogs"="Bryant","Bryant U"="Bryant",
  "Robert Morris"="Robert Morris",
  "Long Island"="Long Island University",
  "Wagner Seahawks"="Wagner",
  "Duquesne Dukes"="Duquesne",
  "Lamar Cardinals"="Lamar",
  "Abilene Christian"="Abilene Christian",
  "Tarleton St"="Tarleton State",
  "SIU"="Southern Illinois","S. Illinois"="Southern Illinois"
)
