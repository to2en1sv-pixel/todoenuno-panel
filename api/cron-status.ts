export default async function handler(req: any, res: any) {
  // 🔥 FORZAMOS A VERCEL A NO GUARDAR EN CACHÉ PARA TENER DATOS FRESCOS
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const apiKey = process.env.CRONJOB_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'Falta CRONJOB_API_KEY en Vercel' });

    const response = await fetch('https://api.cron-job.org/jobs', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    const textData = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Error de cron-job.org', 
        details: textData.substring(0, 100) 
      });
    }

    const data = JSON.parse(textData);
    const jobsIds = [
      process.env.CRONJOB_ID_POST, 
      process.env.CRONJOB_ID_ODOO
    ].filter(Boolean);

    const relevantJobs = (data.jobs || [])
      .filter((job: any) => jobsIds.includes(String(job.jobId)))
      .map((job: any) => ({
        id: String(job.jobId),
        title: job.title,
        url: job.url,
        lastStatus: job.lastStatus,
        // Traducimos el código 1 a "Timeout" para que sea más legible
        lastStatusText: job.lastStatusText || (job.lastStatus === 1 ? 'Timeout' : 'Error de red'),
        lastExecution: job.lastExecution,
        nextExecution: job.nextExecution
      }));

    return res.status(200).json({ jobs: relevantJobs });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
