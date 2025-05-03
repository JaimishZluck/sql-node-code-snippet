import platform from 'platform';
import moment from 'moment';
import momentTimezone from 'moment-timezone';
const serverStartTime = moment.utc();
// Helper to format uptime


export async function healthCheck(req, res) {
  try {

    const now = moment.utc();
    const uptime = formatUptime(moment.duration(now.diff(serverStartTime)));

    const ist = momentTimezone.tz.zone('Asia/Kolkata');
    const startTimeIst = serverStartTime.clone().tz(ist);
    const startTimeFormatted = startTimeIst.format('DD/MM/YYYY, HH:mm:ss');

    const healthCheck = {
      status: 'UP',
      uptime: uptime,
      environment: process.env.NODE_ENV || 'development',
      os: platform.os.family(),
      startTime: startTimeFormatted,
      system: getCpuModel(),
    };

    res.status(200).json({
      statusCode: 200,
      data: healthCheck,
      message: 'Inward Backend is healthy',
    });
  }
  catch (error) {
    console.error('Error in health check:', error);
    res.status(500).json({ status: 'error', message: 'Internal Server Error' });

  }
}
function formatUptime(delta) {
  const totalSeconds = delta.asSeconds();
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}
// Helper to get CPU model
function getCpuModel() {
  // Best-effort for Linux
  try {
    const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const modelNameMatch = cpuInfo.match(/model name\s+:\s+([^\n]+)/);
    if (modelNameMatch) {
      return modelNameMatch[ 1 ].trim();
    }
  } catch (error) {
    // Fallback
    return platform.os.architecture() || 'Unknown';
  }
}