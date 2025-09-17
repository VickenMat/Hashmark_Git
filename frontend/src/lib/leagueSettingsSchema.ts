// src/lib/leagueSettingsSchema.ts
export type WaiverType = 'rolling' | 'reverse' | 'faab';
export type LeagueType = 'redraft' | 'keeper' | 'dynasty';

export interface LeagueSettingsForm {
  leagueName: string;
  leagueLogo: string;
  numberOfTeams: number;

  waiverType: WaiverType;
  waiverBudget?: number;
  waiverMinBid?: number;

  waiverClearance: 'none' | 'tue' | 'wed' | 'thu';
  waiversAfterDropDays: 0 | 1 | 2 | 3;

  tradeReviewDays: 0 | 1 | 2 | 3;
  tradeDeadline: 0 | 9 | 10 | 11 | 12 | 13;

  leagueType: LeagueType;
  extraGameVsMedian: boolean;
  preventDropAfterKickoff: boolean;
  lockAllMoves: boolean;
}

export interface TeamSettingsForm {
  name: string;
  logo: string;
}

