# ================================================================
# R/update_cbb.R  —  College Basketball Elo, 2003-current
# FIX: Conference lookup now uses `conference_competition == TRUE`
#      rows to build a team_id -> conference_name map.
#      For teams not in that map (non-power-conference), we use
#      groups_name from any game they appear in.
# ================================================================

suppressPackageStartupMessages({
  library(hoopR)
  library(dplyr)
  library(readr)
  library(lubridate)
})
source("R/elo_engine.R")
Sys.setenv(TZ = "America/New_York")

CURRENT_SEASON <- most_recent_mbb_season()
SEASONS        <- 2003:(CURRENT_SEASON + 1L)  # +1 catches next season if started
OUT_DIR        <- "docs/CBB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

get_cbb_season <- function(season) {
  message("  CBB ", season, "...")
  tryCatch({
    sched <- load_mbb_schedule(seasons = season) %>%
      mutate(date = as.Date(date)) %>%
      filter(
        home_id != away_id,
        !is.na(home_id), !is.na(away_id),
        !is.na(home_score), !is.na(away_score),
        as.numeric(home_score) != as.numeric(away_score),
        date <= Sys.Date()
      )
    if (nrow(sched) == 0) return(NULL)

    # ── Build team->conference map ─────────────────────────────
    # Use ALL rows with non-empty groups_name, not just conference_competition.
    # This covers many more teams since non-conf games also carry groups_name.
    # Priority: conference_competition games first, then any groups_name row.

    # Step 1: from conference games (most reliable)
    conf_rows <- sched %>%
      filter(isTRUE(conference_competition) | conference_competition == TRUE,
             !is.na(groups_name), trimws(groups_name) != "")

    # Step 2: from ANY game with groups_name (catches remaining teams)
    any_rows <- sched %>%
      filter(!is.na(groups_name), trimws(groups_name) != "",
             !grepl("^[0-9]+$", trimws(groups_name)))  # exclude numeric group IDs

    # Build maps: team_name -> conference
    build_map <- function(df) {
      if (nrow(df) == 0) return(character(0))
      home <- setNames(df$groups_name, df$home_short_display_name)
      away <- setNames(df$groups_name, df$away_short_display_name)
      both <- c(home, away)
      # Deduplicate: prefer the first assignment
      both[!duplicated(names(both))]
    }

    conf_map_priority <- build_map(conf_rows)
    conf_map_any      <- build_map(any_rows)

    # Merge: priority map wins, fill gaps with any_rows map
    all_names  <- unique(c(names(conf_map_priority), names(conf_map_any)))
    conf_map <- ifelse(
      !is.na(conf_map_priority[all_names]),
      conf_map_priority[all_names],
      conf_map_any[all_names]
    )
    names(conf_map) <- all_names
    conf_map <- conf_map[!is.na(names(conf_map)) & names(conf_map) != ""]

    # ── Build games ────────────────────────────────────────────
    games <- sched %>%
      mutate(
        home_pts   = as.numeric(home_score),
        away_pts   = as.numeric(away_score),
        winner     = if_else(home_pts > away_pts,
                             home_short_display_name, away_short_display_name),
        loser      = if_else(home_pts < away_pts,
                             home_short_display_name, away_short_display_name),
        winner_pts = pmax(home_pts, away_pts),
        loser_pts  = pmin(home_pts, away_pts)
      ) %>%
      filter(!is.na(winner), !is.na(loser), winner != loser) %>%
      # `date` is kept (not dropped) specifically so the pre-tournament Elo/
      # Resume Score snapshot below can filter the NCAA Tournament itself
      # back out — see that block's comment for why.
      select(winner, loser, winner_pts, loser_pts, date)

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
  # Momentum window/weight — used by the Momentum computation further down
  # (after the pre-tournament snapshot block). A team's own last
  # MOMENTUM_WINDOW games (by date) are repeated MOMENTUM_WEIGHT times when
  # refitting a "recent form" Elo; momentum is the gap between that and the
  # season's pre-tournament Elo. Tunable the same way as the three
  # constants above.
  MOMENTUM_WINDOW <- 12
  MOMENTUM_WEIGHT <- 3

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
    # number suggests?" — a recency-weighted Elo refit on the SAME
    # non-tournament games (pre_games) used above, where each team's own
    # last MOMENTUM_WINDOW games (by date) are repeated MOMENTUM_WEIGHT
    # times in the game list passed to run_elo(). Repeating a game is a
    # simple, symmetric way to give it extra pull on the fitted rating
    # without breaking Elo's zero-sum per-game update (both participants
    # still trade the same delta on every occurrence, however many times
    # it's repeated). momentum is the gap between that recency-weighted
    # rating and the plain pre-tournament Elo above — positive means
    # recent form is running hotter than the season average, negative
    # means colder.
    #
    # Deliberately built on pre_games, not res$games — the whole point is
    # a team's CURRENT form, and NCAA Tournament games (a) only exist for
    # a completed season and (b) would pull this the wrong way (e.g. a
    # team that just got blown out in the Tournament would show as "cold"
    # for a season that's long over, which isn't a meaningful "momentum"
    # read for anything by then) — so, like pre_tourney_elo/resume_score/
    # sos above, this is always a PRE-tournament number, never a final one.
    #
    # Approximate by design: a game is "recent" from the perspective of
    # whichever of its two teams has it among their own last
    # MOMENTUM_WINDOW games — so a single game can occasionally be
    # up-weighted on behalf of only one of its two participants (e.g. a
    # team with very few games treats all of them as "recent", even one
    # that's old news for a busier opponent). Acceptable for a lightweight
    # form indicator; not a claim of rigor on par with resume_score.
    team_recent_idx <- function(t) {
      rows <- c(which(pre_games$winner == t), which(pre_games$loser == t))
      if (!length(rows)) return(integer(0))
      rows[order(pre_games$date[rows], decreasing = TRUE)][seq_len(min(MOMENTUM_WINDOW, length(rows)))]
    }
    all_teams_pre <- unique(c(pre_games$winner, pre_games$loser))
    recent_idx    <- unique(unlist(lapply(all_teams_pre, team_recent_idx)))

    weight_vec     <- ifelse(seq_len(nrow(pre_games)) %in% recent_idx, MOMENTUM_WEIGHT, 1)
    momentum_games <- pre_games[rep(seq_len(nrow(pre_games)), times = weight_vec), ]

    elo_momentum     <- run_elo(momentum_games, k=30, iters=10, min_games=4)
    elo_momentum_lup <- setNames(elo_momentum$elo, elo_momentum$team)

    # A team absent from the recency-weighted fit (shouldn't happen — it's
    # built from the same pre_games as elo_pre above) falls back to 0
    # (no signal) rather than NA.
    out$momentum <- round(
      ifelse(is.na(elo_momentum_lup[out$team]), 0, elo_momentum_lup[out$team] - out$pre_tourney_elo),
      1
    )
  } else {
    # No games at all before the cutoff (e.g. a data gap) — fall back to
    # the live numbers rather than writing NA into a brand-new column.
    out$pre_tourney_elo <- out$elo
    out$pre_tourney_resume_score <- out$resume_score
    out$pre_tourney_sos <- out$sos
    # No pre-cutoff games means no "recent form" to compute either.
    out$momentum <- 0
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
