# ================================================================
# R/update_cfb_playoff.R  —  CFB Playoff Chance (server-side Monte Carlo)
#
# Runs AFTER update_cfb.R in the same job (needs CFB_Elo_<yr>.csv and
# CFB_Games_<yr>.csv, which update_cfb.R now writes for the current
# season). Only ever touches the CURRENT (active, in-progress) season —
# a completed season's CFP already happened for real, so there is
# nothing to simulate. If the active season isn't far enough along yet
# (few teams, no completed-games file), this script no-ops cleanly.
#
# What it does:
#   1. Reads this season's current Elo/PR/records + completed games.
#   2. Fetches the remaining REGULAR-SEASON schedule from ESPN (games
#      not yet completed, Aug-Nov window — conference championship
#      games are never fetched from ESPN; this script determines the
#      likely CCG participants itself from simulated final standings).
#   3. Runs N_TRIALS Monte Carlo simulations: each remaining game's
#      winner is drawn from the frozen (not updated) Elo win-prob
#      formula, exactly like the Predictor tab's game probabilities.
#      Elo itself is never touched — only simulated W/L records, which
#      feed conference standings, tiebreakers, CCGs, and the CFP field.
#   4. Applies the real 2026 12-team CFP format: 4 guaranteed bids
#      (SEC/Big Ten/Big 12/ACC champions) + 1 to the highest-ranked
#      champion among the six Group-of-Five-style auto-bid leagues
#      (AAC/C-USA/MAC/Mountain West/Pac-12/Sun Belt) + at-large fill to
#      12 by Playoff Rating, seeded 1-12 (seeds 1-4 = bye).
#   5. Publishes per-team playoff / CCG-appearance probabilities, a
#      "what needs to happen" scenario table (data only — the frontend
#      turns it into sentences), and a "right now" field/CCG snapshot,
#      to CFB_Playoff_<yr>.json.
#
# TIEBREAKER METHODOLOGY (same cascade for every conference — see
# README note in the JSON's `methodology` block, and the UI's
# "How this works" card): head-to-head result -> conference win% ->
# record vs common conference opponents -> Playoff Rating (this last
# step is a modeling approximation for the real committee-poll /
# proprietary-rating steps several conferences' bylaws fall back to
# beyond common opponents, which this site has no access to — flagged
# in the UI wherever it could plausibly matter).
# ================================================================
suppressPackageStartupMessages({
  library(dplyr); library(readr); library(httr); library(jsonlite)
})
source("R/cfb_aliases.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
if (as.integer(format(Sys.Date(), "%m")) < 8) CURRENT_YEAR <- CURRENT_YEAR - 1
OUT_DIR <- "docs/CFB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

N_TRIALS <- 2000
HCA <- 55  # must match CFG.hca in docs/sports/cfb.html

# ── Conference structure (hand-kept in sync with PK_CONFS_FALLBACK /
#    CFP_AUTO_CONF_FALLBACK / PK_DIVS_FALLBACK in docs/js/sport-page.js
#    — same underlying 2025-26 alignment facts, just consumed here on
#    the R side instead of client-side). ─────────────────────────────
CCG_CONFS <- c("SEC","Big Ten","Big 12","ACC","Pac-12","Mountain West",
               "AAC","Sun Belt","MAC","C-USA")
POWER4    <- c("SEC","Big Ten","Big 12","ACC")
GROUP_AUTO <- setdiff(CCG_CONFS, POWER4)

SUN_BELT_DIVS <- list(
  East = c("Appalachian State","Coastal Carolina","Georgia Southern",
           "Georgia State","James Madison","Marshall","Old Dominion"),
  West = c("Arkansas State","Louisiana","Louisiana Tech","South Alabama",
           "Southern Miss","Troy","UL Monroe")
)

# Mirrors pkFcsTransitionIneligible() in sport-page.js — North Dakota
# State is in its mandatory FBS transition window and can't win a
# conference title or make the CFP until it lapses.
fcs_transition_ineligible <- function(team, yr) {
  team == "North Dakota State" && yr < 2028
}

message("CFB Playoff Chance sim — season ", CURRENT_YEAR)

# Stop once conference championship week is plausibly underway. Past
# this point, real CCG results start landing in CFB_Games_<yr>.csv as
# ordinary completed conference games (they're still "same conference"
# match-ups), which would make resolve_conf_champion() count that CCG
# toward each team's conference record AND THEN simulate ANOTHER
# hypothetical CCG on top of it — double-counting the title game. The
# hypothetical-season premise this whole script runs on is moot by then
# anyway (the real committee selection is happening), so it's simpler
# and safer to just stop publishing new numbers for the season here.
CCG_WEEK_START <- as.Date(paste0(CURRENT_YEAR, "-12-04"))
if (Sys.Date() >= CCG_WEEK_START) {
  message("  Conference championship week has started (or later) — the ",
          "regular-season-plus-hypothetical-CCG model no longer applies. ",
          "Leaving the last published CFB_Playoff_", CURRENT_YEAR, ".json in place.")
  quit(save = "no", status = 0)
}

# ── Load this run's already-computed current-season data ───────────
elo_csv_path   <- file.path(OUT_DIR, paste0("CFB_Elo_",   CURRENT_YEAR, ".csv"))
games_csv_path <- file.path(OUT_DIR, paste0("CFB_Games_", CURRENT_YEAR, ".csv"))

if (!file.exists(elo_csv_path)) {
  message("  No CFB_Elo_", CURRENT_YEAR, ".csv yet — nothing to simulate. Exiting cleanly.")
  quit(save = "no", status = 0)
}

teams_df <- tryCatch(read_csv(elo_csv_path, show_col_types = FALSE), error = function(e) NULL)
if (is.null(teams_df) || nrow(teams_df) < 20) {
  message("  Season data too thin (", if (is.null(teams_df)) 0 else nrow(teams_df),
          " teams) — skipping this run, will retry next update.")
  quit(save = "no", status = 0)
}
if (!"pr" %in% names(teams_df)) {
  message("  CFB_Elo file has no `pr` column yet — skipping this run.")
  quit(save = "no", status = 0)
}

games_df <- if (file.exists(games_csv_path)) {
  tryCatch(read_csv(games_csv_path, show_col_types = FALSE), error = function(e) NULL)
} else NULL
if (is.null(games_df)) games_df <- data.frame(winner=character(0), loser=character(0),
                                               winner_pts=numeric(0), loser_pts=numeric(0))

message("  Loaded ", nrow(teams_df), " teams, ", nrow(games_df), " completed games.")

# ── Fetch remaining regular-season schedule from ESPN ───────────────
# Mirrors update_cfb.R's fetch_date()/parse_event() pattern exactly
# (same endpoint, same groups=80 FBS filter, same error handling) but
# keeps NOT-YET-COMPLETED games instead of completed ones, and keeps
# home/away team + neutral-site flag instead of a final score.
parse_future_event <- function(ev) {
  tryCatch({
    comp <- ev$competitions[[1]]
    if (isTRUE(comp$status$type$completed)) return(NULL)
    # Skip postponed/cancelled — ESPN marks these via status name, not
    # "completed", so they'd otherwise show up as a phantom remaining game.
    st <- tolower(comp$status$type$name %||% "")
    if (grepl("postpon|cancel", st)) return(NULL)
    comps <- comp$competitors
    if (length(comps) != 2) return(NULL)
    hi <- which(sapply(comps, `[[`, "homeAway") == "home")
    ai <- which(sapply(comps, `[[`, "homeAway") == "away")
    if (!length(hi) || !length(ai)) return(NULL)
    hn <- comps[[hi]]$team$shortDisplayName
    an <- comps[[ai]]$team$shortDisplayName
    if (is.null(hn) || is.null(an) || !nchar(hn) || !nchar(an)) return(NULL)
    neutral <- isTRUE(comp$neutralSite)
    list(home = hn, away = an, neutral = neutral)
  }, error = function(e) NULL)
}

`%||%` <- function(a, b) if (!is.null(a) && length(a) > 0 && !is.na(a[1])) a else b

fetch_future_date <- function(ds) {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
        query = list(dates = ds, groups = 80, limit = 300), timeout(30)),
    error = function(e) NULL)
  if (is.null(resp) || status_code(resp) != 200) return(NULL)
  data <- tryCatch(fromJSON(rawToChar(resp$content), simplifyDataFrame = FALSE),
                    error = function(e) NULL)
  if (is.null(data) || length(data$events) == 0) return(NULL)
  rows <- Filter(Negate(is.null), lapply(data$events, parse_future_event))
  if (!length(rows)) return(NULL)
  data.frame(home = sapply(rows, `[[`, "home"),
             away = sapply(rows, `[[`, "away"),
             neutral = sapply(rows, `[[`, "neutral"),
             stringsAsFactors = FALSE)
}

# Regular season only — stop well before conference championship week
# (early Dec) so a CCG "TBD vs TBD" placeholder, or a bowl game, never
# gets ingested as a real remaining regular-season game. The CCG
# matchup itself is determined by this script's own simulation, not
# fetched from ESPN.
future_dates <- function(yr) {
  today <- Sys.Date()
  end   <- as.Date(paste0(yr, "-11-30"))
  if (today > end) return(as.Date(character(0)))
  seq(today + 1, end, by = "1 day")
}

fdates <- future_dates(CURRENT_YEAR)
message("  Scanning ", length(fdates), " remaining regular-season dates...")

future_rows <- list()
for (d in as.character(fdates)) {
  res <- tryCatch(fetch_future_date(gsub("-", "", d)), error = function(e) NULL)
  if (!is.null(res) && nrow(res) > 0) {
    future_rows <- c(future_rows, list(res))
    Sys.sleep(0.1)
  } else {
    Sys.sleep(0.02)
  }
}

remaining_raw <- if (length(future_rows)) unique(do.call(rbind, future_rows)) else
  data.frame(home = character(0), away = character(0), neutral = logical(0))
message("  Found ", nrow(remaining_raw), " remaining scheduled games (pre-filter).")

# ── Resolve ESPN names to this season's canonical CSV team names ───
all_teams   <- teams_df$team
resolve_to_canonical <- function(t) {
  t <- trimws(t)
  if (t %in% all_teams) return(t)
  if (t %in% names(ALIASES) && ALIASES[[t]] %in% all_teams) return(ALIASES[[t]])
  NA_character_
}

if (nrow(remaining_raw) > 0) {
  remaining_raw$home_c <- vapply(remaining_raw$home, resolve_to_canonical, character(1))
  remaining_raw$away_c <- vapply(remaining_raw$away, resolve_to_canonical, character(1))
  unmatched <- unique(c(remaining_raw$home[is.na(remaining_raw$home_c)],
                        remaining_raw$away[is.na(remaining_raw$away_c)]))
  if (length(unmatched)) {
    message("  Unmatched team names in remaining schedule (dropped, likely FCS/non-D1 opponent): ",
            paste(head(unmatched, 20), collapse = ", "))
  }
  # Keep only games where BOTH sides are teams we're tracking this season
  # (drops FCS/non-FBS buy-games from the "win out" math, same spirit as
  # update_cfb.R's FAKE_TEAMS filter — an FCS cupcake isn't part of the
  # CFP resume math either way).
  remaining <- remaining_raw[!is.na(remaining_raw$home_c) & !is.na(remaining_raw$away_c) &
                             remaining_raw$home_c != remaining_raw$away_c, ]
  remaining <- data.frame(home = remaining$home_c, away = remaining$away_c,
                           neutral = remaining$neutral, stringsAsFactors = FALSE)
  remaining <- unique(remaining)
} else {
  remaining <- data.frame(home = character(0), away = character(0), neutral = logical(0))
}
message("  ", nrow(remaining), " remaining games between tracked FBS teams.")

# ── Win probability for each remaining game (frozen Elo, never updated) ──
elo0 <- setNames(teams_df$elo, teams_df$team)
conf0 <- setNames(teams_df$conference, teams_df$team)
pr0  <- setNames(teams_df$pr, teams_df$team)
# Defensive: a still-winless team's pr can come through as NA from the CSV
# (the real fix is in update_cfb.R's resume_score, but this is cheap
# insurance against any stale CSV that predates that fix, or any other
# future source of NA here) — every downstream `pr0[[tm]]` consumer below
# assumes a real number, and this feeds straight into the JSON `pr` field
# that the frontend calls .toFixed() on with no null-guard.
pr0[is.na(pr0)] <- 0
wins0   <- setNames(teams_df$wins,   teams_df$team)
losses0 <- setNames(teams_df$losses, teams_df$team)

win_prob_home <- function(home, away, neutral) {
  hca <- if (isTRUE(neutral)) 0 else HCA
  eh <- elo0[[home]]; ea <- elo0[[away]]
  1 / (1 + 10^(((ea) - (eh + hca)) / 400))
}

if (nrow(remaining) > 0) {
  remaining$p_home <- mapply(win_prob_home, remaining$home, remaining$away, remaining$neutral)
  remaining$conf <- ifelse(!is.na(conf0[remaining$home]) & !is.na(conf0[remaining$away]) &
                            conf0[remaining$home] == conf0[remaining$away],
                            conf0[remaining$home], NA_character_)
} else {
  remaining$p_home <- numeric(0)
  remaining$conf <- character(0)
}

# ================================================================
# Conference standings + tiebreaker engine
#
# Tiebreak cascade (2-team ties): head-to-head -> record vs common
# conference opponents -> Playoff Rating (approximation; see file
# header). 3+-way ties skip straight to Playoff Rating — resolving a
# real multi-team tie fully (mini round-robin, then common opponents
# among the group, etc.) needs per-conference bylaw detail this model
# doesn't have; PR is the documented fallback either way, so this
# keeps the same accuracy floor without pretending to more precision
# than the 2-team case actually has.
# ================================================================

h2h_winner_v <- function(t1, t2, w_vec, l_vec) {
  hit <- (w_vec == t1 & l_vec == t2) | (w_vec == t2 & l_vec == t1)
  if (!any(hit)) return(NA_character_)
  w1 <- sum(w_vec[hit] == t1); w2 <- sum(w_vec[hit] == t2)
  if (w1 > w2) t1 else if (w2 > w1) t2 else NA_character_
}

common_opp_winner_v <- function(t1, t2, w_vec, l_vec) {
  opp1 <- unique(c(l_vec[w_vec == t1], w_vec[l_vec == t1]))
  opp2 <- unique(c(l_vec[w_vec == t2], w_vec[l_vec == t2]))
  common <- setdiff(intersect(opp1, opp2), c(t1, t2))
  if (!length(common)) return(NA_character_)
  rec <- function(t) {
    hitw <- w_vec == t & l_vec %in% common
    hitl <- l_vec == t & w_vec %in% common
    n <- sum(hitw) + sum(hitl)
    if (n == 0) return(NA_real_)
    sum(hitw) / n
  }
  p1 <- rec(t1); p2 <- rec(t2)
  if (is.na(p1) || is.na(p2)) return(NA_character_)
  if (p1 > p2) t1 else if (p2 > p1) t2 else NA_character_
}

# Ranks `teams` best-to-worst by conference record, resolving ties per
# the cascade above. `w_vec`/`l_vec` = ALL conference games this trial
# (winner/loser character vectors) for the whole conference (not just
# `teams`) so common-opponent / cross-division results still count.
rank_conf_teams <- function(teams, w_vec, l_vec) {
  n <- length(teams)
  if (n == 0) return(character(0))
  if (n == 1) return(teams)
  cw <- setNames(integer(n), teams); cl <- setNames(integer(n), teams)
  if (length(w_vec)) {
    tw <- table(w_vec); tl <- table(l_vec)
    hit_w <- intersect(names(tw), teams); hit_l <- intersect(names(tl), teams)
    cw[hit_w] <- as.integer(tw[hit_w])
    cl[hit_l] <- as.integer(tl[hit_l])
  }
  pct <- ifelse((cw + cl) > 0, cw / (cw + cl), 0)
  ord <- order(-pct, -cw)
  st <- teams[ord]; sp <- pct[ord]
  out <- character(0); i <- 1
  while (i <= n) {
    j <- i
    while (j < n && abs(sp[j + 1] - sp[i]) < 1e-9) j <- j + 1
    block <- st[i:j]
    if (length(block) == 1) {
      out <- c(out, block)
    } else if (length(block) == 2) {
      w <- h2h_winner_v(block[1], block[2], w_vec, l_vec)
      if (is.na(w)) w <- common_opp_winner_v(block[1], block[2], w_vec, l_vec)
      if (is.na(w)) w <- block[which.max(pr0[block])]
      out <- c(out, w, setdiff(block, w))
    } else {
      out <- c(out, block[order(-pr0[block])])
    }
    i <- j + 1
  }
  out
}

# ================================================================
# Conference membership (from THIS run's live conference assignment —
# never hand-typed here, so it can never drift from what update_cfb.R
# just computed) + division split for Sun Belt.
# ================================================================
conf_teams <- split(teams_df$team, teams_df$conference)
conf_teams <- conf_teams[intersect(CCG_CONFS, names(conf_teams))]
missing_ccg_confs <- setdiff(CCG_CONFS, names(conf_teams))
if (length(missing_ccg_confs)) {
  message("  Note: no teams found this run for: ", paste(missing_ccg_confs, collapse=", "),
          " — that conference will show no CCG projection.")
}

conf_champion_pool <- function(conf) {
  ts <- conf_teams[[conf]]
  if (is.null(ts)) return(character(0))
  ts[!vapply(ts, fcs_transition_ineligible, logical(1), yr = CURRENT_YEAR)]
}

# ── Completed-season conference games (fixed across every trial) ───
games_df$winner_conf <- conf0[games_df$winner]
games_df$loser_conf  <- conf0[games_df$loser]
base_conf_hit <- !is.na(games_df$winner_conf) & !is.na(games_df$loser_conf) &
                 games_df$winner_conf == games_df$loser_conf
base_conf_w <- games_df$winner[base_conf_hit]
base_conf_l <- games_df$loser[base_conf_hit]
base_conf_of <- games_df$winner_conf[base_conf_hit]  # which conf each base game belongs to

# Determines the champion of one conference given this trial's simulated
# conference-game results layered on top of the completed ones. Returns
# list(champion, participant1, participant2) — participant1/2 are the two
# CCG teams (or a single division-restricted winner-take-all for Sun Belt).
resolve_conf_champion <- function(conf, sim_w, sim_l, deterministic = FALSE) {
  base_hit <- base_conf_of == conf
  w_vec <- c(base_conf_w[base_hit], sim_w)
  l_vec <- c(base_conf_l[base_hit], sim_l)
  pool <- conf_champion_pool(conf)
  if (length(pool) < 2) return(list(champion = NA_character_, p1 = NA_character_, p2 = NA_character_))

  divs <- SUN_BELT_DIVS_FOR(conf)
  if (!is.null(divs)) {
    leaders <- vapply(divs, function(dteams) {
      dteams <- intersect(dteams, pool)
      if (!length(dteams)) return(NA_character_)
      rank_conf_teams(dteams, w_vec, l_vec)[1]
    }, character(1))
    leaders <- leaders[!is.na(leaders)]
    if (length(leaders) < 2) return(list(champion = NA_character_, p1 = NA_character_, p2 = NA_character_))
    p1 <- leaders[1]; p2 <- leaders[2]
  } else {
    top2 <- rank_conf_teams(pool, w_vec, l_vec)[1:2]
    p1 <- top2[1]; p2 <- top2[2]
  }
  if (is.na(p1) || is.na(p2)) return(list(champion = NA_character_, p1 = p1, p2 = p2))

  p_p1 <- win_prob_home(p1, p2, TRUE)  # CCG is neutral-site
  # deterministic=TRUE is for the single "if the season ended today"
  # snapshot, where a coin-flip result would be misleading — show the
  # current favorite (higher seed, p1) as the presumptive champ instead
  # of a random draw. Every Monte Carlo trial uses the real draw.
  champ <- if (deterministic) p1 else (if (runif(1) < p_p1) p1 else p2)
  list(champion = champ, p1 = p1, p2 = p2, champ_prob = round(p_p1, 4))
}

SUN_BELT_DIVS_FOR <- function(conf) if (conf == "Sun Belt") SUN_BELT_DIVS else NULL

message("  Conference structure ready: ", paste(names(conf_teams), collapse=", "))

# Teams in the mandatory FBS transition window can't receive ANY CFP bid
# (auto or at-large) — not just barred from winning their conference.
# conf_champion_pool() already keeps them off the CCG; this keeps them
# out of the at-large pool too.
cfp_ineligible_teams <- all_teams[vapply(all_teams, fcs_transition_ineligible,
                                          logical(1), yr = CURRENT_YEAR)]
if (length(cfp_ineligible_teams)) {
  message("  CFP-ineligible this season (FBS transition window): ",
          paste(cfp_ineligible_teams, collapse = ", "))
}

# ================================================================
# Monte Carlo simulation
#
# Elo is frozen (win probabilities always use elo0, never updated
# mid-simulation). What DOES change per trial is each team's simulated
# final win_pct and resume_score — which feed a per-trial Playoff
# Rating exactly like update_cfb.R's real PR formula — since a team's
# resume obviously depends on which games it wins/loses the rest of
# the way, even though its rating doesn't. A simulated CCG appearance
# adds one more (win or loss) to that team's final record/resume too,
# matching how the real committee ranks teams after CCGs are played.
# ================================================================
resume0 <- setNames(teams_df$resume_score, teams_df$team); resume0[is.na(resume0)] <- 0
gp0     <- setNames(teams_df$games_played, teams_df$team); gp0[is.na(gp0)] <- 0

team_idx <- setNames(seq_along(all_teams), all_teams)
team_n_remaining <- setNames(integer(length(all_teams)), all_teams)
if (nrow(remaining) > 0) {
  tab <- table(c(remaining$home, remaining$away))
  team_n_remaining[names(tab)] <- as.integer(tab)
}
MAX_REM <- max(c(0L, team_n_remaining))
NT <- length(all_teams)

bucket_trials  <- matrix(0L, nrow = NT, ncol = MAX_REM + 1, dimnames = list(all_teams, NULL))
bucket_playoff <- matrix(0L, nrow = NT, ncol = MAX_REM + 1, dimnames = list(all_teams, NULL))
CCG_STATES <- c("no_reach", "reach_lose", "reach_win")
ccg_bucket_trials  <- array(0L, dim = c(NT, MAX_REM + 1, 3), dimnames = list(all_teams, NULL, CCG_STATES))
ccg_bucket_playoff <- array(0L, dim = c(NT, MAX_REM + 1, 3), dimnames = list(all_teams, NULL, CCG_STATES))
playoff_count   <- setNames(integer(NT), all_teams)
reach_ccg_count <- setNames(integer(NT), all_teams)
win_ccg_count   <- setNames(integer(NT), all_teams)
seed_sum        <- setNames(numeric(NT), all_teams)   # for average projected seed among playoff trials
bye_count       <- setNames(integer(NT), all_teams)
matchup_count   <- new.env()  # conf -> named int vector "TeamA vs TeamB" -> trial count

if (nrow(remaining) > 0) {
  outcomes <- matrix(runif(nrow(remaining) * N_TRIALS), nrow = nrow(remaining)) < remaining$p_home
} else {
  outcomes <- matrix(logical(0), nrow = 0, ncol = N_TRIALS)
}

run_trial <- function(t) {
  if (nrow(remaining) > 0) {
    home_wins <- outcomes[, t]
    winner_vec <- ifelse(home_wins, remaining$home, remaining$away)
    loser_vec  <- ifelse(home_wins, remaining$away, remaining$home)
  } else {
    winner_vec <- character(0); loser_vec <- character(0)
  }
  simulate_season(winner_vec, loser_vec)
}

# Shared by every Monte Carlo trial (called with THAT trial's simulated
# remaining-game results) AND the deterministic "if the season ended
# today" snapshot (called with winner_vec/loser_vec = character(0), i.e.
# no remaining games simulated at all) — same CCG + CFP-field logic
# either way, so the two views can never drift apart from each other.
simulate_season <- function(winner_vec, loser_vec, deterministic = FALSE) {
  # Resolve every conference's CCG for this trial
  conf_results <- list()
  for (conf in names(conf_teams)) {
    conf_results[[conf]] <- resolve_conf_champion(conf, winner_vec, loser_vec, deterministic = deterministic)
  }
  champions_by_conf <- vapply(conf_results, function(r) r$champion %||% NA_character_, character(1))

  # Regular-season simulated tallies
  reg_wins  <- setNames(integer(NT), all_teams)
  reg_games <- setNames(integer(NT), all_teams)
  resume_add <- setNames(numeric(NT), all_teams)
  if (length(winner_vec)) {
    tw <- table(winner_vec); tg <- table(c(winner_vec, loser_vec))
    reg_wins[names(tw)]  <- as.integer(tw)
    reg_games[names(tg)] <- as.integer(tg)
    contrib <- pmax(0, elo0[loser_vec] - 1350)
    ra <- tapply(contrib, winner_vec, sum)
    resume_add[names(ra)] <- as.numeric(ra)
  }

  # Layer CCG game onto both participants' records
  ccg_win_bonus  <- setNames(integer(NT), all_teams)
  ccg_game_bonus <- setNames(integer(NT), all_teams)
  ccg_resume_bonus <- setNames(numeric(NT), all_teams)
  for (conf in names(conf_results)) {
    r <- conf_results[[conf]]
    if (is.na(r$p1) || is.na(r$p2)) next
    ccg_game_bonus[r$p1] <- ccg_game_bonus[r$p1] + 1L
    ccg_game_bonus[r$p2] <- ccg_game_bonus[r$p2] + 1L
    if (!is.na(r$champion)) {
      loser <- setdiff(c(r$p1, r$p2), r$champion)
      ccg_win_bonus[r$champion] <- ccg_win_bonus[r$champion] + 1L
      ccg_resume_bonus[r$champion] <- ccg_resume_bonus[r$champion] + max(0, elo0[[loser]] - 1350)
    }
  }

  final_win_pct <- (wins0 + reg_wins + ccg_win_bonus) /
                   pmax(1, gp0 + reg_games + ccg_game_bonus)
  final_resume  <- resume0 + resume_add + ccg_resume_bonus
  final_pr <- elo0 * (pmax(0.01, final_win_pct) ^ 0.6) + sqrt(pmax(0, final_resume))

  # ── Build the 12-team field per real 2026 CFP rules ───────────────
  # auto_bid_teams tracks ONLY the guaranteed-bid teams (<=5: one per
  # P4 conference + the single highest-PR Group-of-Five-style champ) —
  # kept distinct from `field` itself, because a team can also reach
  # the field as an at-large (e.g. a Group-of-Five champ who wasn't the
  # single highest-ranked one) without that being an auto bid.
  field <- character(0); auto_bid_teams <- character(0)
  for (conf in intersect(POWER4, names(champions_by_conf))) {
    ch <- champions_by_conf[[conf]]
    if (!is.na(ch)) { field <- c(field, ch); auto_bid_teams <- c(auto_bid_teams, ch) }
  }
  grp_champs <- champions_by_conf[intersect(GROUP_AUTO, names(champions_by_conf))]
  grp_champs <- grp_champs[!is.na(grp_champs)]
  if (length(grp_champs)) {
    best <- grp_champs[[which.max(final_pr[unlist(grp_champs)])]]
    if (!best %in% field) field <- c(field, best)
    auto_bid_teams <- c(auto_bid_teams, best)
  }
  pr_order <- setdiff(names(sort(final_pr, decreasing = TRUE)), cfp_ineligible_teams)
  need <- 12 - length(field)
  if (need > 0) field <- c(field, head(setdiff(pr_order, field), need))

  field_sorted <- field[order(-final_pr[field])]

  list(champions_by_conf = champions_by_conf, conf_results = conf_results,
       reg_wins = reg_wins, field = field_sorted, final_pr = final_pr,
       auto_bid_teams = auto_bid_teams)
}

message("  Running ", N_TRIALS, " Monte Carlo trials over ", nrow(remaining), " remaining games...")
t0 <- Sys.time()
for (t in seq_len(N_TRIALS)) {
  res <- run_trial(t)

  reg_wins_full <- res$reg_wins
  made_playoff  <- setNames(all_teams %in% res$field, all_teams)
  col_idx <- reg_wins_full[all_teams] + 1L
  row_idx <- team_idx
  idx_mat <- cbind(row_idx, col_idx)

  bucket_trials[idx_mat] <- bucket_trials[idx_mat] + 1L
  if (any(made_playoff)) {
    made_mat <- idx_mat[made_playoff[all_teams], , drop = FALSE]
    bucket_playoff[made_mat] <- bucket_playoff[made_mat] + 1L
  }
  playoff_count <- playoff_count + as.integer(made_playoff[all_teams])

  if (length(res$field)) {
    seeds <- seq_along(res$field)
    seed_sum[res$field] <- seed_sum[res$field] + seeds
    bye_teams <- res$field[seeds <= 4]
    bye_count[bye_teams] <- bye_count[bye_teams] + 1L
  }

  for (conf in names(res$conf_results)) {
    r <- res$conf_results[[conf]]
    if (is.na(r$p1) || is.na(r$p2)) next
    reach_ccg_count[r$p1] <- reach_ccg_count[r$p1] + 1L
    reach_ccg_count[r$p2] <- reach_ccg_count[r$p2] + 1L
    if (!is.na(r$champion)) win_ccg_count[r$champion] <- win_ccg_count[r$champion] + 1L

    pair_key <- paste(sort(c(r$p1, r$p2)), collapse = " vs ")
    mc <- if (is.null(matchup_count[[conf]])) integer(0) else matchup_count[[conf]]
    cur <- mc[pair_key]
    mc[pair_key] <- (if (is.na(cur)) 0L else cur) + 1L
    matchup_count[[conf]] <- mc

    pool <- conf_champion_pool(conf)
    state <- setNames(rep(1L, length(pool)), pool)  # 1 = no_reach
    state[r$p1] <- 2L; state[r$p2] <- 2L
    if (!is.na(r$champion)) state[r$champion] <- 3L
    ri <- team_idx[pool]
    ci <- reg_wins_full[pool] + 1L
    si <- state[pool]
    arr_idx <- cbind(ri, ci, si)
    ccg_bucket_trials[arr_idx] <- ccg_bucket_trials[arr_idx] + 1L
    made_this <- made_playoff[pool]
    if (any(made_this)) {
      ccg_bucket_playoff[arr_idx[made_this, , drop = FALSE]] <-
        ccg_bucket_playoff[arr_idx[made_this, , drop = FALSE]] + 1L
    }
  }

  if (t %% 500 == 0) message("    ...", t, "/", N_TRIALS, " trials (",
                              round(as.numeric(Sys.time() - t0, units = "secs")), "s elapsed)")
}
message("  Simulation done in ", round(as.numeric(Sys.time() - t0, units = "secs")), "s.")

# ================================================================
# "If the season ended today" snapshot — deterministic (no simulated
# games), current favorite wins each CCG. Used for the field/bracket
# card and each conference's current standings; entirely separate from
# the probabilistic teams[]/conferences[].likely_matchup data below.
# ================================================================
today_snapshot <- simulate_season(character(0), character(0), deterministic = TRUE)

conf_record_str <- function(team, w_vec, l_vec) {
  w <- sum(w_vec == team); l <- sum(l_vec == team)
  paste0(w, "-", l)
}

conferences_json <- list()
for (conf in names(conf_teams)) {
  base_hit <- base_conf_of == conf
  w_vec <- base_conf_w[base_hit]; l_vec <- base_conf_l[base_hit]
  display_pool <- conf_teams[[conf]]
  order_now <- rank_conf_teams(display_pool, w_vec, l_vec)

  standings <- lapply(order_now, function(tm) {
    list(team = tm,
         conference_record = conf_record_str(tm, w_vec, l_vec),
         overall_record = paste0(wins0[[tm]], "-", losses0[[tm]]),
         elo = round(elo0[[tm]], 1),
         pr = round(pr0[[tm]], 1),
         eligible = !fcs_transition_ineligible(tm, CURRENT_YEAR))
  })

  mc <- if (is.null(matchup_count[[conf]])) integer(0) else matchup_count[[conf]]
  likely_matchup <- if (length(mc)) {
    best_i <- which.max(mc)
    list(matchup = names(mc)[best_i], pct = round(mc[[best_i]] / N_TRIALS, 4))
  } else NULL

  today <- today_snapshot$conf_results[[conf]]

  conferences_json[[conf]] <- list(
    has_divisions = !is.null(SUN_BELT_DIVS_FOR(conf)),
    power4 = conf %in% POWER4,
    standings = standings,
    projected_ccg = if (!is.null(today) && !is.na(today$p1)) list(team1 = today$p1, team2 = today$p2) else NULL,
    projected_champion_today = if (!is.null(today)) today$champion else NA_character_,
    likely_matchup = likely_matchup,
    tiebreak_note = paste0("Head-to-head result, then record vs common conference opponents, then Playoff ",
                            "Rating. The last step is this site's own approximation for the real-world steps ",
                            "several conferences' tiebreaker rules fall back to (committee rankings or ",
                            "proprietary rating services this project has no access to).")
  )
}

# ── Per-team output ──────────────────────────────────────────────
team_remaining_games <- function(team) {
  if (nrow(remaining) == 0) return(list())
  rows <- remaining[remaining$home == team | remaining$away == team, ]
  if (!nrow(rows)) return(list())
  lapply(seq_len(nrow(rows)), function(i) {
    r <- rows[i, ]
    is_home <- identical(r$home, team)
    opp <- if (is_home) r$away else r$home
    wp  <- if (is_home) r$p_home else (1 - r$p_home)
    list(opponent = opp, home = is_home, neutral = isTRUE(r$neutral),
         win_prob = round(wp, 4), conference_game = !is.na(r$conf))
  })
}

team_win_buckets <- function(team) {
  n_rem <- team_n_remaining[[team]]
  lapply(0:n_rem, function(w) {
    tr <- bucket_trials[team, w + 1]; pf <- bucket_playoff[team, w + 1]
    list(wins = w, trials = as.integer(tr),
         playoff_pct = if (tr > 0) round(pf / tr, 4) else NA)
  })
}

team_ccg_buckets <- function(team) {
  n_rem <- team_n_remaining[[team]]
  lapply(0:n_rem, function(w) {
    row <- list(wins = w)
    for (s in seq_along(CCG_STATES)) {
      tr <- ccg_bucket_trials[team, w + 1, s]; pf <- ccg_bucket_playoff[team, w + 1, s]
      row[[CCG_STATES[s]]] <- list(trials = as.integer(tr),
                                    playoff_pct = if (tr > 0) round(pf / tr, 4) else NA)
    }
    row
  })
}

teams_json <- lapply(all_teams, function(tm) {
  pc <- playoff_count[[tm]]; rc <- reach_ccg_count[[tm]]
  ccg_relevant <- (rc / N_TRIALS) >= 0.15
  list(
    team = tm,
    conference = unname(conf0[[tm]]),
    elo = round(elo0[[tm]], 1),
    pr = round(pr0[[tm]], 1),
    record = paste0(wins0[[tm]], "-", losses0[[tm]]),
    cfp_ineligible = tm %in% cfp_ineligible_teams,
    playoff_pct   = round(pc / N_TRIALS, 4),
    reach_ccg_pct = round(rc / N_TRIALS, 4),
    win_ccg_pct   = round(win_ccg_count[[tm]] / N_TRIALS, 4),
    bye_pct       = round(bye_count[[tm]] / N_TRIALS, 4),
    avg_seed      = if (pc > 0) round(seed_sum[[tm]] / pc, 2) else NA,
    remaining_games = team_remaining_games(tm),
    scenario = list(
      games_remaining = team_n_remaining[[tm]],
      win_out_pct = {
        b <- bucket_trials[tm, team_n_remaining[[tm]] + 1]
        p <- bucket_playoff[tm, team_n_remaining[[tm]] + 1]
        if (b > 0) round(p / b, 4) else NA
      },
      buckets = team_win_buckets(tm),
      ccg_relevant = ccg_relevant,
      ccg_buckets = if (ccg_relevant) team_ccg_buckets(tm) else NULL
    )
  )
})

# ── Today's field (deterministic snapshot) ──────────────────────
field_today <- lapply(seq_along(today_snapshot$field), function(i) {
  tm <- today_snapshot$field[i]
  list(seed = i, team = tm, bye = i <= 4,
       conference = unname(conf0[[tm]]),
       auto_bid = tm %in% today_snapshot$auto_bid_teams)
})

# The 5 auto-bid slots for the tracker chip row: one per P4 conference
# (its current champion-if-season-ended-today) + the single highest-PR
# leader among the Group-of-Five-style auto conferences. Nothing is
# mathematically clinched this early — these are today's leaders, which
# is exactly what field_today/conferences[].projected_champion_today
# already represent, just pre-picked into the 5 slots the UI shows.
auto_bid_tracker <- list()
for (conf in intersect(POWER4, names(today_snapshot$champions_by_conf))) {
  ch <- today_snapshot$champions_by_conf[[conf]]
  auto_bid_tracker[[length(auto_bid_tracker) + 1]] <- list(
    conference = conf, power4 = TRUE, team = if (is.na(ch)) NULL else ch)
}
grp_today <- today_snapshot$champions_by_conf[intersect(GROUP_AUTO, names(today_snapshot$champions_by_conf))]
grp_today <- grp_today[!is.na(grp_today)]
if (length(grp_today)) {
  best_conf <- names(grp_today)[which.max(pr0[unlist(grp_today)])]
  auto_bid_tracker[[length(auto_bid_tracker) + 1]] <- list(
    conference = best_conf, power4 = FALSE, team = grp_today[[best_conf]],
    note = "Highest-ranked champion among the Group-of-Five-style auto conferences.")
}

out_json <- list(
  season = CURRENT_YEAR,
  updated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  n_trials = N_TRIALS,
  hca = HCA,
  methodology = paste0(
    "Server-side Monte Carlo simulation (", N_TRIALS, " trials/update). Each remaining regular-season game's ",
    "winner is drawn from the same Elo win-probability formula used elsewhere on this site; Elo itself is ",
    "never updated mid-simulation, only simulated win/loss records, which do feed each team's Playoff Rating ",
    "(win_pct and resume components) the same way real results would. The 12-team field follows the real ",
    "2026 CFP format: guaranteed bids for the SEC/Big Ten/Big 12/ACC champions, one more for the highest-",
    "ranked champion among AAC/C-USA/MAC/Mountain West/Pac-12/Sun Belt, remaining slots at-large by Playoff ",
    "Rating, seeded 1-12 (seeds 1-4 = bye). Conference tiebreakers: head-to-head, then record vs common ",
    "conference opponents, then Playoff Rating as an approximation for any deeper committee-poll or ",
    "proprietary-rating step a conference's real bylaws call for. Sun Belt is simulated with its East/West ",
    "divisions; every other auto-bid conference uses a single round-robin-style table."
  ),
  auto_bid_conferences = CCG_CONFS,
  power4_conferences = POWER4,
  auto_bid_tracker = auto_bid_tracker,
  field_today = field_today,
  conferences = conferences_json,
  teams = teams_json
)

out_path <- file.path(OUT_DIR, paste0("CFB_Playoff_", CURRENT_YEAR, ".json"))
write(toJSON(out_json, auto_unbox = TRUE, null = "null", na = "null", pretty = FALSE), out_path)
message("  -> wrote ", out_path, " (", round(file.info(out_path)$size / 1024), " KB)")
message("CFB Playoff Chance sim done.")
