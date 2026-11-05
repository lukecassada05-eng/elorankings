# ================================================================
# R/update_cbb.R  —  College Basketball Elo, 2003-current
# Data: ESPN scoreboard API, fetched day-by-day — same pathway as
#       R/update_cfb.R, replacing the previous hoopR::load_mbb_schedule()
#       pipeline (see "DATA SOURCE SWITCH" below for why, and what was/
#       wasn't preserved by the switch).
#
# DATA SOURCE SWITCH (ESPN-direct, matching update_cfb.R):
# This used to pull every season's schedule from hoopR::load_mbb_schedule(),
# which doesn't talk to ESPN itself — it reads a pre-built dataset from the
# sportsdataverse/hoopR-mbb-data GitHub repo, which re-scrapes ESPN and
# republishes on its OWN schedule (about once a day, ~07:00 UTC). That
# extra hop meant this script could never be any fresher than that daily
# upstream refresh no matter how often this workflow itself ran — confirmed
# directly against a brand-new 2026-27 season showing only a handful of
# games days after real games had been played. update_cfb.R never has this
# problem, because it hits ESPN's own scoreboard API directly, one calendar
# day at a time — this file now does the same thing, so CBB freshness is
# bounded only by ESPN's own data, exactly like CFB.
#
# EQUIVALENCE FOR SETTLED SEASONS: for any season that's already over, this
# should produce the SAME game list as before — both the old and new paths
# are ultimately reading the same ESPN schedule/box-score data (hoopR-mbb-
# data's own pipeline IS an ESPN scoreboard scraper, just upstream of this
# script instead of inside it), filtered the same way (completed games
# only, no ties, two distinct teams, scoped to Division I via groups=50 —
# the same group code already used elsewhere in this file for
# fetch_conf_champs()). The conference-assignment ALGORITHM for a settled
# season is also left untouched (same conf_rows/any_rows/build_map logic,
# same priority order) — it just now reads its groups_name/
# conference_competition inputs from this file's own per-game ESPN fetch
# instead of from hoopR's dataframe columns, which carry the identical
# fields under identical semantics (confirmed directly against live ESPN
# responses: a real conference game carries an event-level `groups` object
# with the conference's full name and `conferenceCompetition:true` on its
# competition; a non-conference game carries neither).
#
# NEW-SEASON CONFERENCE FIX: the OLD schedule-derived conf_map can only
# resolve a team's conference once it's PLAYED a game ESPN tags with
# groups_name metadata — harmless for a settled season (every team has
# dozens of those by the end), but broken for the first days of a brand
# new one, which is exactly the bug reported against the 2026-27 season.
# ESPN's STANDINGS endpoint (fetch_cbb_conf_map() below) carries conference
# membership directly — it's how ESPN organizes the groupings, not
# something derived from results — so it's correct from day one, and
# because the request is scoped to group=50 (Division I only — confirmed
# directly against ESPN: the root of that response is labeled "NCAA
# Division I"), any team that doesn't show up in it genuinely isn't
# Division I, which is exactly what "D2-or-worse stays NA" requires. This
# is used ONLY for the current/next season (s >= CURRENT_SEASON, applied in
# the main loop below) — a settled season keeps the schedule-derived
# conf_map exactly as it behaved before this file ever talked to ESPN
# directly, so no historical conference data changes either.
# ================================================================

suppressPackageStartupMessages({
  library(readr)
  library(httr)
  library(jsonlite)
})
source("R/elo_engine.R")
Sys.setenv(TZ = "America/New_York")

# CURRENT_SEASON uses the same end-year convention as everywhere else in
# this file (season 2027 == the 2026-27 season — confirmed directly against
# ESPN's own standings endpoint, which reports season=2027 as
# seasonDisplayName "2026-27"). Once the calendar reaches July, the next
# men's season is the one coming up, so CURRENT_SEASON rolls forward a year
# ahead of the regular Jan-Jun "that season is still live" window. This
# replaces hoopR::most_recent_mbb_season() now that hoopR is no longer
# attached for the main fetch loop — write_cbb_tournament_json() further
# down still calls hoopR::load_mbb_schedule() by its full :: name, which is
# untouched by this change and keeps working as long as the hoopR package
# stays installed; it just no longer needs to be library()'d here.
today          <- Sys.Date()
CURRENT_SEASON <- as.integer(format(today, "%Y")) +
                  (if (as.integer(format(today, "%m")) >= 7) 1L else 0L)
SEASONS        <- 2003:(CURRENT_SEASON + 1L)  # +1 catches next season if started
OUT_DIR        <- "docs/CBB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Parse one ESPN scoreboard event ───────────────────────────────
# Mirrors update_cfb.R's parse_event(), plus the extra fields (home/away
# name, groups_name, conference_competition) the schedule-derived conf_map
# below needs — hoopR's load_mbb_schedule() used to hand these over as
# dataframe columns; ESPN's own event JSON carries the same two signals
# directly (confirmed live): a real conference game's competition object
# has conferenceCompetition:true and the EVENT object carries a `groups`
# object naming the conference; a non-conference game has neither.
parse_cbb_event <- function(ev) {
  tryCatch({
    comp <- ev$competitions[[1]]
    if (!isTRUE(comp$status$type$completed)) return(NULL)
    comps <- comp$competitors
    if (length(comps) != 2) return(NULL)
    hi  <- which(sapply(comps, `[[`, "homeAway") == "home")
    ai  <- which(sapply(comps, `[[`, "homeAway") == "away")
    if (!length(hi) || !length(ai)) return(NULL)
    hs  <- suppressWarnings(as.numeric(comps[[hi]]$score))
    as_ <- suppressWarnings(as.numeric(comps[[ai]]$score))
    hn  <- comps[[hi]]$team$shortDisplayName
    an  <- comps[[ai]]$team$shortDisplayName
    if (is.na(hs) || is.na(as_) || is.null(hn) || is.null(an) ||
        hs == as_ || hn == an) return(NULL)

    # ESPN has returned the event-level `groups` field both as a single
    # object and as a list of group objects — handle either shape rather
    # than assume one.
    g  <- ev$groups
    gn <- NA_character_
    if (!is.null(g) && length(g) > 0) {
      nm <- if (!is.null(g$name)) g$name else g[[1]]$name
      if (!is.null(nm) && nchar(nm)) gn <- nm
    }

    list(winner = if (hs > as_) hn else an,
         loser  = if (hs > as_) an else hn,
         winner_pts = max(hs, as_), loser_pts = min(hs, as_),
         home_name = hn, away_name = an,
         groups_name = gn,
         conference_competition = isTRUE(comp$conferenceCompetition))
  }, error = function(e) NULL)
}

# ── Fetch one calendar day's completed D-I games ───────────────────
# groups=50 is the same Division I scope already used by
# fetch_conf_champs()'s groups_param elsewhere in this file.
fetch_cbb_date <- function(ds) {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",
        query = list(dates = ds, groups = 50, limit = 400), timeout(30)),
    error = function(e) NULL)
  if (is.null(resp) || status_code(resp) != 200) return(NULL)
  data <- tryCatch(fromJSON(rawToChar(resp$content), simplifyDataFrame = FALSE),
                   error = function(e) NULL)
  if (is.null(data) || length(data$events) == 0) return(NULL)
  rows <- Filter(Negate(is.null), lapply(data$events, parse_cbb_event))
  if (!length(rows)) return(NULL)
  data.frame(
    winner      = sapply(rows, `[[`, "winner"),
    loser       = sapply(rows, `[[`, "loser"),
    winner_pts  = as.numeric(sapply(rows, `[[`, "winner_pts")),
    loser_pts   = as.numeric(sapply(rows, `[[`, "loser_pts")),
    date        = as.Date(ds, format = "%Y%m%d"),
    home_name   = sapply(rows, `[[`, "home_name"),
    away_name   = sapply(rows, `[[`, "away_name"),
    groups_name = sapply(rows, `[[`, "groups_name"),
    conference_competition = sapply(rows, `[[`, "conference_competition"),
    stringsAsFactors = FALSE
  )
}

# ── Which calendar days to query for a season ──────────────────────
# Season `s` (end-year convention) runs Nov 1 of (s-1) through mid-April of
# s — generous on both ends (real D-I tip-off is NCAA-set in early November
# and the championship game is the first Monday of April) so this is a
# SUPERSET of hoopR's own season window, not a narrower one: the goal for a
# settled season is to miss nothing that was there before, not to trim it.
# A non-game day just comes back empty from ESPN (handled below), so the
# wider window costs a little extra request volume and nothing else.
cbb_game_dates <- function(s) {
  all_dates <- seq(as.Date(paste0(s - 1L, "-11-01")), as.Date(paste0(s, "-04-15")), by = "1 day")
  all_dates[all_dates <= Sys.Date()]
}

# ── Live Division I conference map (current/next season only) ─────
# See "NEW-SEASON CONFERENCE FIX" at the top of this file. Mirrors
# update_cfb.R's fetch_cfb_conf_map() almost exactly — same candidate-path
# probing, same per-entry extraction — just a different sport_path/season
# scope (`group=50` instead of CFB's `level=1`).
fetch_cbb_conf_map <- function(season) {
  url <- paste0(
    "https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings",
    "?season=", season, "&group=50"
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

get_cbb_season <- function(season) {
  message("  CBB ", season, "...")
  tryCatch({
    dates     <- cbb_game_dates(season)
    all_games <- list()
    for (d in as.character(dates)) {
      res <- fetch_cbb_date(gsub("-", "", d))
      if (!is.null(res) && nrow(res) > 0) {
        all_games <- c(all_games, list(res))
        Sys.sleep(0.15)  # polite delay only on game days
      } else {
        Sys.sleep(0.02)  # minimal delay on non-game days
      }
    }
    if (!length(all_games)) return(NULL)

    sched <- unique(do.call(rbind, all_games))
    sched <- sched[!is.na(sched$winner) & sched$winner != "" &
                   sched$winner != sched$loser, ]
    if (nrow(sched) == 0) return(NULL)

    # ── Build team->conference map (settled-season behavior, SAME
    # algorithm as before — see the big comment at the top of this file
    # for why it's unchanged) ──────────────────────────────────────
    # NOTE: the old dplyr version wrote this as
    # `isTRUE(conference_competition) | conference_competition == TRUE` —
    # isTRUE() isn't vectorized, so against a whole column that clause
    # always evaluated to a single FALSE and the OR silently fell through
    # to the `== TRUE` half for every row. Written directly here as the
    # vectorized check that was actually doing the work, to the same
    # effect (parse_cbb_event() always hands conference_competition a
    # clean TRUE/FALSE, never NA, so `== TRUE` alone is safe).
    conf_rows <- sched[sched$conference_competition == TRUE &
                       !is.na(sched$groups_name) &
                       trimws(sched$groups_name) != "", ]
    # exclude numeric group IDs — kept for defensive parity with the old
    # hoopR-column version; this file's own groups_name is always a human
    # name or NA, never a raw numeric ID, so this is normally a no-op.
    any_rows <- sched[!is.na(sched$groups_name) &
                      trimws(sched$groups_name) != "" &
                      !grepl("^[0-9]+$", trimws(sched$groups_name)), ]

    build_map <- function(df) {
      if (nrow(df) == 0) return(character(0))
      home <- setNames(df$groups_name, df$home_name)
      away <- setNames(df$groups_name, df$away_name)
      both <- c(home, away)
      both[!duplicated(names(both))]
    }

    conf_map_priority <- build_map(conf_rows)
    conf_map_any      <- build_map(any_rows)

    all_names <- unique(c(names(conf_map_priority), names(conf_map_any)))
    conf_map <- ifelse(
      !is.na(conf_map_priority[all_names]),
      conf_map_priority[all_names],
      conf_map_any[all_names]
    )
    names(conf_map) <- all_names
    conf_map <- conf_map[!is.na(names(conf_map)) & names(conf_map) != ""]

    games <- sched[, c("winner", "loser", "winner_pts", "loser_pts", "date")]
    if (nrow(games) == 0) return(NULL)

    list(games = games, conf_map = conf_map)
  }, error = function(e) { message("  ERROR: ", e$message); NULL })
}

for (s in SEASONS) {
  res <- get_cbb_season(s)
  # BUG FIX: this used to require >=50 league-wide games before writing
  # anything for a season — same bug, same fix, as R/update_nhl.R's
  # identical floor (see that file's comment for the full writeup). A
  # brand-new season published nothing at all for its first several days
  # of games, during which the frontend's season picker defaults to that
  # season's label (EloSeason.withCurrent() in docs/js/utils.js) and shows
  # "No data yet" instead of real rankings — and the floor was redundant
  # here too: run_elo()'s own min_games (below) already damps any
  # individual team's rating until it has played min_games games, which is
  # the real, precise defense against small-sample distortion, applied per
  # team rather than as an all-or-nothing league-wide gate. The
  # conference-map build above already tolerates a team not yet having a
  # resolvable conference (logged as "NA conf" and left NA, not blocked on)
  # — a team that hasn't played yet simply won't appear in res$games at
  # all, which is a normal, already-handled case, not a reason to skip the
  # whole season's write. Now only a real zero-games case (off-season,
  # fetch failure) skips the write.
  if (is.null(res) || nrow(res$games) < 1) {
    message("  Skipping CBB ", s)
    next
  }

  # ── Live D1 conference lookup — current/next season only ───────────
  # See "NEW-SEASON CONFERENCE FIX" at the top of this file. A settled
  # season (s < CURRENT_SEASON) keeps res$conf_map exactly as
  # get_cbb_season() built it — no change here. For the current/next
  # season, the live standings-based map is authoritative and already
  # scoped to Division I, so it REPLACES the schedule-derived guess
  # rather than merely filling gaps in it — that schedule-derived guess
  # is precisely the thing that was unreliable this early in a new
  # season. Any team the live map doesn't resolve (including a real
  # non-D1 opponent in a buy game) is left for the last-known-conference
  # fallback further down, then NA — never promoted into a conference it
  # doesn't belong to.
  if (s >= CURRENT_SEASON) {
    live_conf_map <- fetch_cbb_conf_map(s)
    message("  Live D1 conference map (", s, "): ", length(live_conf_map), " teams",
            if (!length(live_conf_map)) " — keeping schedule-derived map as fallback" else "")
    if (length(live_conf_map) > 0) res$conf_map <- live_conf_map
  }

  elo <- run_elo(res$games, k=30, iters=10, min_games=4)
  elo <- attach_best_wins(elo, res$games)
  sos <- compute_sos(res$games, elo)

  # ── Conference tournament champion detection ──────────────
  # After conf tournaments end (early March), use actual champs for auto bids
  # BUG FIX: this used to pass "&groups=50" as the 3rd *positional* arg,
  # which binds to fetch_conf_champs()'s date_from parameter (not
  # groups_param, which is 5th) — that silently mangled the request URL
  # (dates=&groups=50-...) so the ESPN fetch never returned usable data
  # and conf_champ came out NA for literally every team in every season.
  # Confirmed empirically: conf_champ was NA in 100% of rows in every
  # already-generated CBB CSV. Passing it by name fixes the URL.
  champs_raw <- tryCatch(
    fetch_conf_champs("basketball/mens-college-basketball", s, groups_param = "&groups=50"),
    error = function(e) { message("  fetch_conf_champs error: ", conditionMessage(e)); character(0) }
  )
  Sys.sleep(0.3)  # light backoff — this loop can make dozens of ESPN calls per run
  # Build champ_map: team_name → TRUE
  # champs_raw is conf_name → team_shortDisplayName
  # We need to match to our canonical team names via conf_map
  conf_champ_map <- NULL
  if (length(champs_raw) > 0) {
    # Map shortDisplayName to canonical using existing conf_map
    all_teams <- names(res$conf_map)
    champ_teams <- character(0)
    for (team in champs_raw) {
      # Exact match first
      if (team %in% all_teams) {
        champ_teams <- c(champ_teams, team)
      } else {
        # Fuzzy: find closest match
        matched <- agrep(team, all_teams, ignore.case=TRUE, value=TRUE, max.distance=0.15)
        if (length(matched) > 0) champ_teams <- c(champ_teams, matched[1])
      }
    }
    if (length(champ_teams) > 0) {
      conf_champ_map <- setNames(rep(FALSE, length(all_teams)), all_teams)
      conf_champ_map[champ_teams] <- TRUE
      message("  Conf champs found: ", paste(champ_teams, collapse=", "))
    }
  }

  out <- build_output(elo, season=s, conf_map=res$conf_map, sos_map=sos,
                      conf_champ_map=conf_champ_map)

  # ── Resume score: quality-win credit MINUS bad-loss penalty ─────────
  # Sum of (opponent Elo − WIN_BASE) across wins, minus a penalty summed
  # across losses, both floored at 0 PER GAME (pmax(0, ...) before
  # summing). Replaces the old win-only formula — see chat history for the
  # real-2025-26-data trial this was validated against before shipping.
  #
  # WIN_BASE = 900 (was 1000, briefly 850): a win over a sub-900 opponent
  # still earns nothing, but this credits more of a strong team's actual
  # win total than 1000 did — chosen specifically so a very-high-volume,
  # lower-SOS team (e.g. a 32-2 season against a weaker conference) isn't
  # buried by teams with fewer, higher-quality wins purely because of
  # where the old floor sat. Teams can legitimately drop below either floor
  # in this Elo
  # system (any team under 4 games played gets its rating halved each
  # iteration — see run_elo()'s min_games damping), so the per-game floor
  # isn't just defensive, it's a real case here.
  #
  # LOSS_BASE / LOSS_DIVISOR = 3000 / 2: each loss costs
  # max(0, (3000 − opponent_elo) / 2) — losing to a stronger opponent
  # costs less than losing to a weak one. 3000 sits ~230 points above the
  # real 2025-26 Elo ceiling (Michigan, 2766.4), so under real data this
  # basically never zeroes out — every loss costs *something* even
  # against the best team in the country — but it still differentiates a
  # bad loss from a defensible one.
  #
  # SAFETY NET (per-game floor on the loss side, mirroring the win-side
  # floor above): without pmax(0, ...) here, a loss to an opponent whose
  # Elo exceeds LOSS_BASE would make (LOSS_BASE − opponent_elo) negative,
  # which would SUBTRACT from the penalty total — i.e. literally increase
  # a team's résumé score for losing a game. That can't happen with real
  # 2025-26 data (nothing is within 230 points of 3000), but a single
  # exceptional team in a future season could cross it, and this floor is
  # what guarantees a loss can never be worth more than 0 points — never
  # a gain — regardless of who it's against.
  #
  # A ~30-game CBB season means raw sums run into the tens of thousands,
  # so resume_score itself (not just an internal intermediate) is the
  # FOURTH ROOT of that net value — a monotonic compression down to a
  # readable single/low-double-digit scale, same relative ordering,
  # smaller number.
  #
  # SIGN-PRESERVING ROOT: net^0.25 on a negative net produces NaN in R —
  # raising a negative number to a fractional power is undefined over the
  # reals (confirmed directly: (-2700)^0.25 returns NaN with a warning).
  # Any team whose loss penalty exceeds its win credit — a mediocre
  # record against a tough schedule, exactly the bubble-caliber case this
  # metric most needs to differentiate — would hit that. sign(net) *
  # abs(net)^0.25 keeps the same ordering and the same compression on
  # both sides of zero, so a bad résumé now shows as a real negative
  # number instead of NA/blank. (The frontend's display and tooltip code
  # — fmtResumeScore/resumeScoreHeader in docs/js/sport-page.js — were
  # updated alongside this so a negative score renders as the actual
  # number, not as "no data available".)
  #
  # This is a disclosed Elo-based approximation of "résumé strength," not
  # the NCAA selection committee's real NET/Quadrant system: no live NET
  # feed, no scoring-margin/efficiency inputs, and — notably — no game
  # location (home/neutral/away), which the real Quad system weights
  # heavily and this script doesn't have the data to reproduce (the games
  # extracted above carry no date/site, only winner/loser/score). Same
  # "honest approximation" spirit as R/update_cfb.R's resume_score /
  # Playoff Rating and R/standings_engine.R's HONESTY NOTE.
  WIN_BASE     <- 900
  LOSS_BASE    <- 3000
  LOSS_DIVISOR <- 2
  # Momentum window — used by the Momentum computation further down (after
  # the pre-tournament snapshot block). A team needs at least this many
  # total non-tournament games before "their last MOMENTUM_WINDOW games"
  # means anything distinct from "their whole season" — below it, momentum
  # comes out NA (see that block's own comment for why, and for why this
  # used to also have a MOMENTUM_WEIGHT re-fit step that got removed after
  # it turned out to be badly biased). Tunable the same way as the three
  # constants above.
  MOMENTUM_WINDOW <- 12

  elo_lup <- setNames(elo$elo, elo$team)
  win_raw <- tapply(seq_len(nrow(res$games)), res$games$winner,
                    function(rows) sum(pmax(0, elo_lup[res$games$loser[rows]] - WIN_BASE), na.rm = TRUE))
  loss_raw <- tapply(seq_len(nrow(res$games)), res$games$loser,
                     function(rows) sum(pmax(0, (LOSS_BASE - elo_lup[res$games$winner[rows]]) / LOSS_DIVISOR), na.rm = TRUE))
  # tapply() only produces an entry for teams with >=1 win (win_raw) or
  # >=1 loss (loss_raw) — an undefeated team is simply absent from
  # loss_raw, so index-by-name would return NA; absent means 0, not
  # "unknown" (same fix as update_cfb.R, now applied on both sides).
  #
  # as.numeric() wrapper is load-bearing, not cosmetic: tapply()'s result
  # carries class "array" (with a dim attribute) even though it's 1-D, and
  # indexing it by name — win_raw[out$team] — preserves that array class
  # straight through ifelse()/round() into the new column. readr::
  # write_csv() refuses to write a matrix/array-classed column ("x must
  # not contain list or matrix columns"), which broke every CBB season's
  # write the first time this ran in GitHub Actions. as.numeric() collapses
  # it back to a plain atomic vector before it ever reaches `out`.
  win_sum  <- as.numeric(ifelse(is.na(win_raw[out$team]),  0, win_raw[out$team]))
  loss_sum <- as.numeric(ifelse(is.na(loss_raw[out$team]), 0, loss_raw[out$team]))
  net <- win_sum - loss_sum
  # Rounded to 4 decimal places (was 2) so the frontend's extra display
  # precision (fmtResumeScore in docs/js/sport-page.js, now 3 decimals) has
  # real digits behind it instead of trailing zeros.
  out$resume_score <- round(sign(net) * abs(net) ^ 0.25, 4)

  # ── Pre-tournament Elo/Resume Score snapshot ────────────────────────
  # The Rankings tab is meant to show the FINAL, whole-season picture for
  # a completed season — Elo and Resume Score computed over every game,
  # NCAA Tournament included. The Bracketology tab is a different
  # question: "what did the field/seeding look like going into Selection
  # Sunday", which by definition can only be answered with games that had
  # already happened BEFORE the committee picked the field — the real
  # committee never saw the Tournament's own results, so folding them into
  # the number used for seeding is incoherent for any completed season.
  # This computes exactly the same two numbers (same WIN_BASE/LOSS_BASE/
  # LOSS_DIVISOR/safety-net/sign-preserving-root formula and the same
  # run_elo() params) a second time, over a games subset that stops at the
  # NCAA Tournament's start.
  #
  # Cutoff: March 18 of the season's own spring year — the same date the
  # frontend's own conference-tournament-champion sweep already assumes
  # the window ends by (see fetchConfChamps() in docs/js/sport-page.js:
  # "Round of 64 starts ~Mar 19-20"), so the two already agree on where
  # "the regular season + conference tournaments" stops and "the NCAA
  # Tournament" begins, rather than introducing a second, possibly
  # inconsistent definition of the same boundary. A date-based cutoff was
  # chosen over trying to classify individual games as NCAA-Tournament-or-
  # not (the way write_cbb_tournament_json() below attempts to, off
  # notes_headline/season_type) specifically because that classification
  # is the one documented at the bottom of this file as unreliable against
  # hoopR's schedule data for this exact purpose.
  #
  # For the CURRENT, in-progress season this cutoff hasn't been reached
  # yet, so pre_games == res$games (nothing to exclude) and these two
  # columns come out identical to the live elo/resume_score above — which
  # is correct: there's no "final" season to distinguish from "pre-
  # tournament" until the season actually finishes.
  cutoff    <- as.Date(paste0(s, "-03-18"))
  pre_games <- res$games[!is.na(res$games$date) & res$games$date <= cutoff, ]

  if (nrow(pre_games) >= 1) {
    elo_pre     <- run_elo(pre_games, k=30, iters=10, min_games=4)
    elo_pre_lup <- setNames(elo_pre$elo, elo_pre$team)

    win_raw_pre  <- tapply(seq_len(nrow(pre_games)), pre_games$winner,
                           function(rows) sum(pmax(0, elo_pre_lup[pre_games$loser[rows]] - WIN_BASE), na.rm = TRUE))
    loss_raw_pre <- tapply(seq_len(nrow(pre_games)), pre_games$loser,
                           function(rows) sum(pmax(0, (LOSS_BASE - elo_pre_lup[pre_games$winner[rows]]) / LOSS_DIVISOR), na.rm = TRUE))
    win_sum_pre  <- as.numeric(ifelse(is.na(win_raw_pre[out$team]),  0, win_raw_pre[out$team]))
    loss_sum_pre <- as.numeric(ifelse(is.na(loss_raw_pre[out$team]), 0, loss_raw_pre[out$team]))
    net_pre      <- win_sum_pre - loss_sum_pre

    # A team entirely absent from elo_pre_lup (no pre-cutoff games at all —
    # shouldn't happen for a real D-I team, but a mid-season addition to
    # the schedule or a data gap could produce one) falls back to the
    # live/final numbers rather than a bare 1500/0, so it never looks like
    # a data error in the Bracketology view.
    out$pre_tourney_elo <- ifelse(is.na(elo_pre_lup[out$team]), out$elo, elo_pre_lup[out$team])
    out$pre_tourney_resume_score <- round(
      ifelse(is.na(elo_pre_lup[out$team]), out$resume_score, sign(net_pre) * abs(net_pre) ^ 0.25),
      4
    )

    # Pre-tournament SOS — same idea as above (what the schedule strength
    # looked like before the Tournament itself started), computed with the
    # same compute_sos() used for the live `sos` column, just over
    # pre_games/elo_pre instead of the full season. This is CSV-only data:
    # per explicit request it is NOT surfaced in the Bracketology tab (no
    # frontend change accompanies this), unlike pre_tourney_elo/
    # pre_tourney_resume_score above which that tab does use. Rounded to 1
    # decimal to match build_output()'s rounding of the live `sos` column.
    sos_pre <- compute_sos(pre_games, elo_pre)
    out$pre_tourney_sos <- round(
      ifelse(is.na(sos_pre[out$team]), out$sos, sos_pre[out$team]),
      1
    )

    # ── Momentum ──────────────────────────────────────────────────────
    # "Is this team playing better or worse lately than their season-long
    # rating would predict?"
    #
    # REVISED after shipping — the first version of this re-ran run_elo()
    # on a copy of pre_games with each team's own last MOMENTUM_WINDOW
    # games repeated 3x, then took the gap vs the plain pre-tournament
    # Elo. That looked fine on paper (duplicating a game still trades the
    # same delta between the same two teams, so it seemed zero-sum) but
    # was badly biased in practice, confirmed directly against the live
    # site's own data (nearly every team showed a large positive number)
    # and reproduced in a standalone simulation before writing this
    # replacement. Two compounding causes: (1) run_elo()'s min_games
    # halving counts RAW OCCURRENCES in the games list, so tripling a
    # team's games pushes its cumulative games_played past min_games
    # sooner — this real dataset has hundreds of "teams" that are tiny
    # schools playing exactly ONE buy game against a real D-I opponent
    # all season, and tripling their one game let them dodge 2 of their
    # usual 3 halving passes, producing an enormous bogus number for
    # them, and for every real team that had beaten one of them (that
    # win got tripled too, flagged "recent" on the patsy's behalf even
    # when it wasn't recent for the real team at all); and (2) even with
    # that edge case removed, run_elo() reprocesses its game list for
    # `iters` passes using each pass's already-diverged ratings as the
    # input to the next — a reinforcing loop, not one that converges to
    # a stable equilibrium — so a team's final rating depends on how
    # much total "volume" got fed through it, and reweighting a subset
    # of games changes that volume unevenly across teams.
    #
    # Fix: don't re-fit Elo at all. Compare actual results in a team's
    # last MOMENTUM_WINDOW non-tournament games to what its ALREADY-
    # COMPUTED, stable pre-tournament Elo (elo_pre_lup above) would have
    # predicted against those specific opponents' own stable Elo — the
    # same win-probability formula run_elo() itself uses for one game,
    # just scored once per recent game instead of iterated. Each game
    # contributes k·log(margin+1)·(actual − expected); summing that over
    # the window gives a rating-point "performance surplus": positive
    # means recent results have outrun what the season rating expected,
    # negative means they've fallen short. Nothing here re-fits or
    # reweights a game list, so it can't change how many games a team is
    # considered to have played, and it can't compound across iterations
    # — it only ever compares one already-known number (actual) against
    # another (expected, from numbers already computed above).
    #
    # Built on pre_games, not res$games, for the same reason as
    # pre_tourney_elo/resume_score/sos above: NCAA Tournament games only
    # exist for a completed season and would pull a "current form" read
    # the wrong way for a season that's long over — this is always a
    # PRE-tournament number. A team needs at least MOMENTUM_WINDOW total
    # non-tournament games for "last MOMENTUM_WINDOW" to mean anything
    # distinct from "its whole season" (and, not incidentally, that's
    # also what kept the old version's one-game patsy teams out of the
    # bug above) — below that, momentum comes out NA rather than a
    # number built from too little data.
    all_teams_pre    <- unique(c(pre_games$winner, pre_games$loser))
    team_total_games <- table(c(pre_games$winner, pre_games$loser))
    momentum_vec     <- setNames(rep(NA_real_, length(all_teams_pre)), all_teams_pre)

    for (t in all_teams_pre) {
      if (is.na(team_total_games[t]) || team_total_games[t] < MOMENTUM_WINDOW) next
      Rt <- elo_pre_lup[t]
      if (is.na(Rt)) next
      rows <- c(which(pre_games$winner == t), which(pre_games$loser == t))
      rows <- rows[order(pre_games$date[rows], decreasing = TRUE)][seq_len(MOMENTUM_WINDOW)]
      surplus <- 0
      for (i in rows) {
        is_winner <- pre_games$winner[i] == t
        opp <- if (is_winner) pre_games$loser[i] else pre_games$winner[i]
        Ro  <- elo_pre_lup[opp]
        if (is.na(Ro)) next
        ew     <- 1.0 / (1.0 + 10^((unname(Ro) - unname(Rt)) / 400.0))
        actual <- if (is_winner) 1 else 0
        margin <- max(as.numeric(pre_games$winner_pts[i]) - as.numeric(pre_games$loser_pts[i]), 1)
        adj_k  <- 30 * log(margin + 1)
        surplus <- surplus + adj_k * (actual - ew)
      }
      momentum_vec[t] <- surplus
    }

    out$momentum <- round(ifelse(is.na(momentum_vec[out$team]), NA_real_, momentum_vec[out$team]), 1)

    # ── Luck ────────────────────────────────────────────────────────────
    # "How many more (or fewer) games has this team won than its own
    # schedule-adjusted scoring-MARGIN profile says it should have?" — the
    # same question KenPom's Luck rating answers, built the same way his
    # is: from a rating driven purely by scoring margin, never by win/loss
    # itself, so a team that keeps winning close games it "shouldn't" (by
    # margin) shows positive, and a team that keeps losing close games it
    # "should" win by margin shows negative.
    #
    # This can't reuse elo_pre_lup the way Momentum does. Elo IS fit from
    # win/loss (margin only scales HOW MUCH a win/loss moves the rating,
    # via adj_k) — "actual result vs. what my own Elo predicts" compares a
    # team's record against a rating built largely from that same record.
    # Momentum gets away with a similar comparison only because it's
    # restricted to the most recent 12 games against a rating mostly built
    # from the other ~20 or so — real dilution, not real independence. A
    # season-long Luck number needs a rating that's genuinely independent
    # of win/loss from the start, so this builds a SECOND rating here,
    # never used anywhere else in this file: an opponent-adjusted scoring-
    # margin rating, solved the same iterative way a "Simple Rating
    # System" (Sports-Reference/Massey-style) is — each team's rating is
    # the average, across its games, of (that game's own point margin +
    # that game's opponent's current rating), repeated until it stops
    # moving. Purely margin-driven, never looks at who won or lost, so
    # there's no circularity feeding into it. Same pre_games/cutoff as
    # everything else in this block — regular season + conference
    # tournaments, never the NCAA Tournament itself.
    MARGIN_RATING_ITERS <- 100
    MARGIN_RATING_TOL   <- 1e-4

    margin_edge_team <- c(pre_games$winner, pre_games$loser)
    margin_edge_opp  <- c(pre_games$loser,  pre_games$winner)
    margin_diff      <- pre_games$winner_pts - pre_games$loser_pts
    margin_edge_val  <- c(margin_diff, -margin_diff)

    margin_rating <- setNames(rep(0, length(all_teams_pre)), all_teams_pre)
    for (iter in seq_len(MARGIN_RATING_ITERS)) {
      step        <- margin_edge_val + margin_rating[margin_edge_opp]
      new_rating  <- tapply(step, margin_edge_team, mean)
      new_rating  <- setNames(as.numeric(new_rating), names(new_rating))[names(margin_rating)]
      delta       <- max(abs(new_rating - margin_rating))
      margin_rating <- new_rating
      if (delta < MARGIN_RATING_TOL) break
    }
    # Recenter so the league-wide average margin rating is exactly 0 —
    # standard SRS convention, and keeps this from drifting season to
    # season as a pure artifact of wherever the iteration happens to start.
    margin_rating <- margin_rating - mean(margin_rating)

    # Convert a margin-rating gap between two teams into a predicted win
    # probability — this file's version of the pythagorean/log5 curve
    # KenPom calibrates for the same purpose. Fit fresh each season
    # (logistic regression, one slope + intercept, over every pre-
    # tournament game from both teams' perspective) rather than assumed,
    # since how spread out ratings are — and so how much a given margin-
    # rating gap should "mean" in win-probability terms — isn't the same
    # in the first week of a season as it is in week 15.
    luck_edge_actual <- c(rep(1L, nrow(pre_games)), rep(0L, nrow(pre_games)))
    luck_edge_diff   <- margin_rating[margin_edge_team] - margin_rating[margin_edge_opp]

    luck_fit <- tryCatch(
      suppressWarnings(glm(luck_edge_actual ~ luck_edge_diff, family = binomial(link = "logit"))),
      error = function(e) NULL
    )
    pred_prob <- if (!is.null(luck_fit)) {
      as.numeric(predict(luck_fit, type = "response"))
    } else {
      # Too few/too lopsided games to fit a curve (very early season) —
      # fall back to flat 50/50 so Luck stays computable (and honest: with
      # no real curve, there's nothing yet to call a team better or worse
      # than "expected" relative to) rather than erroring the whole
      # season's write out.
      rep(0.5, length(luck_edge_diff))
    }

    luck_contrib <- luck_edge_actual - pred_prob
    luck_vec_raw <- tapply(luck_contrib, margin_edge_team, sum)
    luck_vec     <- setNames(as.numeric(luck_vec_raw), names(luck_vec_raw))

    # Raw wins-above/below-expected (e.g. +2.3 = "won about 2 more games
    # than its margin-based schedule-adjusted profile predicted") — NOT a
    # per-game rate the way KenPom displays his own version.
    out$luck <- round(ifelse(is.na(luck_vec[out$team]), NA_real_, luck_vec[out$team]), 1)
  } else {
    # No games at all before the cutoff (e.g. a data gap) — fall back to
    # the live numbers rather than writing NA into a brand-new column.
    out$pre_tourney_elo <- out$elo
    out$pre_tourney_resume_score <- out$resume_score
    out$pre_tourney_sos <- out$sos
    # No pre-cutoff games means no "recent form"/"luck" to compute either.
    out$momentum <- NA_real_
    out$luck     <- NA_real_
  }

  # ── Conference fallback: carry forward last season's conference ───────
  # Early in a brand-new season, ESPN's schedule feed often hasn't populated
  # a resolvable `groups_name` conference field yet for every team (see
  # get_cbb_season()'s conf_map comment above) — a team's first few games of
  # the year can come through with conference=NA even though it obviously
  # still belongs to the same conference it played in last season. SEASONS
  # is processed in ascending order (see top of file), so by the time season
  # `s` gets here, season `s-1`'s CSV has ALREADY been written to disk —
  # either earlier in this very run, or left over from a prior run — so it
  # can be read back here purely to fill the gap. This never overrides a
  # conference that THIS season's own data already resolved, only fills in
  # where it's still NA: conference realignment is rare and always announced
  # well ahead of the season, so "last known conference" is a safe stand-in
  # for "currently unresolved," not a claim that nothing ever changes.
  na_conf <- is.na(out$conference)
  if (any(na_conf)) {
    prev_path <- file.path(OUT_DIR, paste0("CBB_Elo_", s - 1L, ".csv"))
    prev_conf <- tryCatch({
      if (file.exists(prev_path)) {
        p <- readr::read_csv(prev_path, show_col_types = FALSE)
        setNames(p$conference, p$team)
      } else NULL
    }, error = function(e) NULL)
    if (!is.null(prev_conf)) {
      fallback <- prev_conf[out$team[na_conf]]
      out$conference[na_conf] <- ifelse(is.na(fallback), NA_character_, unname(fallback))
    }
  }

  out_path <- file.path(OUT_DIR, paste0("CBB_Elo_", s, ".csv"))
  out <- attach_movers(out, out_path)
  write_csv(out, out_path)
  message("  -> ", nrow(out), " teams, conf: ",
          sum(!is.na(out$conference)), "/", nrow(out),
          if (!is.null(conf_champ_map)) paste0(", champs: ", sum(out$conf_champ, na.rm=TRUE)) else "")
}


# ================================================================
# Write NCAA Tournament JSON (uses hoopR schedule data)
# ================================================================
write_cbb_tournament_json <- function(yr) {
  tryCatch({
    sched <- hoopR::load_mbb_schedule(seasons = yr)
    if (is.null(sched) || nrow(sched) == 0) {
      message("  No schedule data for ", yr); return(invisible(NULL))
    }
    
    # Tournament games: season_type = 3 (postseason) AND date in Mar-Apr
    # hoopR season_type can be character or integer
    tourn <- sched[
      !is.na(sched$season_type) & as.character(sched$season_type) == "3" &
      !is.na(sched$game_date) &
      format(as.Date(sched$game_date), "%m") %in% c("03","04") &
      !is.na(sched$home_score) & !is.na(sched$away_score),
    ]
    
    if (nrow(tourn) == 0) {
      message("  No tournament games found for ", yr); return(invisible(NULL))
    }
    

    
    # Build game list
    games <- list()
    seen  <- list()
    for (i in seq_len(nrow(tourn))) {
      row <- tourn[i,]
      hs <- suppressWarnings(as.numeric(row$home_score))
      as_ <- suppressWarnings(as.numeric(row$away_score))
      if (is.na(hs) || is.na(as_) || hs == as_) next
      
      hn <- tryCatch(as.character(row$home_team_name), error=function(e)
              tryCatch(as.character(row$home_short_display_name),error=function(e)""))
      an <- tryCatch(as.character(row$away_team_name), error=function(e)
              tryCatch(as.character(row$away_short_display_name),error=function(e)""))
      if (nchar(hn)==0 || nchar(an)==0) next
      
      dt <- tryCatch(as.character(as.Date(row$game_date)), error=function(e)"")
      
      # Deduplicate
      dk <- paste(hn, an, dt, sep="|")
      if (!is.null(seen[[dk]])) next; seen[[dk]] <- TRUE
      
      if (hs > as_) { winner <- hn; loser <- an; ws <- hs; ls <- as_ }
      else          { winner <- an; loser <- hn; ws <- as_; ls <- hs  }
      
      # Round name from notes_headline
      rnd <- tryCatch(as.character(row$notes_headline), error=function(e)"")
      if (is.null(rnd) || is.na(rnd)) rnd <- ""
      
      # Skip conference tournament games (they run late Feb / early Mar)
      # Conference tournament names contain conf name + "tournament" or "championship"
      # NCAA tournament games either have NCAA round names or blank notes
      if (nchar(rnd) > 0) {
        # If it has a round name, must be an NCAA tournament round
        ncaa_rounds <- c("First Four","First Round","Second Round",
                         "Sweet 16","Elite Eight","Final Four","Championship",
                         "Round of 64","Round of 32","Regional","National")
        conf_keywords <- c("Conference","Conference Tournament","A-10","ACC","SEC",
                          "Big Ten","Big 12","Pac-","American","Mountain West",
                          "Sun Belt","MAC","C-USA","MWC","AAC")
        is_ncaa <- any(sapply(ncaa_rounds, function(x) grepl(x, rnd, ignore.case=TRUE)))
        is_conf <- any(sapply(conf_keywords, function(x) grepl(x, rnd, fixed=TRUE)))
        if (!is_ncaa || is_conf) next
      }
      
      games <- c(games, list(list(
        winner=winner, loser=loser,
        winner_score=ws, loser_score=ls,
        date=dt, round=rnd
      )))
    }
    
    message("  CBB ", yr, ": ", length(games), " tournament games")
    if (length(games) == 0) return(invisible(NULL))
    
    # Build series (single-elimination: win=1)
    # Group by round
    round_groups <- list()
    for (g in games) {
      rn <- if(nchar(g$round)>0) g$round else "_"
      if (is.null(round_groups[[rn]])) round_groups[[rn]] <- list()
      round_groups[[rn]] <- c(round_groups[[rn]], list(g))
    }
    
    # Ordered round names for CBB
    round_order <- c("First Four","First Round","Round of 64","Second Round",
                     "Round of 32","Sweet 16","Elite Eight","Final Four","Championship")
    
    all_series <- list(); all_elim <- c()
    for (rn in names(round_groups)) {
      rg <- round_groups[[rn]]
      for (g in rg) {
        all_series <- c(all_series, list(list(
          t1=g$winner, t2=g$loser, w1=1L, w2=0L, done=TRUE,
          loser=g$loser, round=g$round, date=g$date
        )))
        all_elim <- c(all_elim, g$loser)
      }
    }
    
    # Sort series by round order then date
    if (length(all_series) > 1) {
      get_round_order <- function(rnd) {
        idx <- which(sapply(round_order, function(r) grepl(r, rnd, ignore.case=TRUE)))
        if (length(idx)) min(idx) else 99L
      }
      rord <- sapply(all_series, function(s) get_round_order(s$round))
      dord <- sapply(all_series, function(s) s$date)
      all_series <- all_series[order(rord, dord)]
    }
    
    today <- Sys.Date()
    completed <- today > as.Date(paste0(yr, "-04-10"))
    
    result <- list(
      year=yr, sport="CBB", completed=completed,
      games=games,
      series=all_series,
      eliminated=as.list(unique(all_elim)),
      updated=format(Sys.time(), "%Y-%m-%d %H:%M UTC")
    )
    
    out_dir  <- "docs/CBB/data"
    dir.create(out_dir, showWarnings=FALSE, recursive=TRUE)
    out_file <- file.path(out_dir, paste0("tournament_", yr, ".json"))
    jsonlite::write_json(result, out_file, auto_unbox=TRUE, pretty=TRUE)
    message("  Written: ", out_file)
  }, error=function(e) message("  CBB tournament error for ", yr, ": ", e$message))
}

# NOTE: CBB tournament_YYYY.json generation intentionally does NOT run here
# anymore. This function and R/backfill_playoff_data.R's fetch_cbb_games()
# were two independent implementations writing the exact same output file
# from two different GitHub Actions jobs (this one runs first, in parallel;
# backfill runs afterward, post-merge, and would overwrite it) — and this
# copy's season_type=="3" filter against hoopR's schedule was silently
# returning zero rows every single run, every season, confirmed empirically
# (every tournament_YYYY.json this wrote was an identical 146-byte empty
# stub). Rather than run two competing writers, the single source of truth
# for this file is now backfill_playoff_data.R, which runs once (after all
# sport branches are merged) and tries ESPN's scoreboard endpoint directly
# before falling back to hoopR.
message("CBB tournament JSON done.")
