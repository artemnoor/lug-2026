export function createRatingRows(teams = []) {
  return teams.map((team) => {
    const achievements = team.achievements || [];
    const approved = achievements.filter((item) => item.status === 'approved');
    const achievementPoints = approved.reduce((sum, item) => sum + Number(item.points || 0), 0);
    const video = team.videoCard || { status: 'none', score: null };
    const videoPoints = video.status === 'approved' ? Number(video.score || 0) : 0;
    const byDirection = {};
    approved.forEach((item) => { byDirection[item.direction] = (byDirection[item.direction] || 0) + Number(item.points || 0); });
    return {
      team,
      admitted: team.isAdmitted === true,
      approvedCount: approved.length,
      totalCount: achievements.length,
      pendingCount: achievements.filter((item) => item.status === 'pending').length,
      achievementPoints,
      videoPoints,
      videoStatus: video.status,
      total: achievementPoints + videoPoints,
      byDirection
    };
  }).sort((left, right) => right.total - left.total || right.achievementPoints - left.achievementPoints || (left.team.name || '').localeCompare(right.team.name || '', 'ru'));
}
