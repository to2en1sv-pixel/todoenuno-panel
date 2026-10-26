export default async function handler(req: any, res: any) {
  try {
    const apiKey = process.env.CRONJOB_API_KEY;
    if (!apiKey) throw new Error('Falta CRONJOB_API_KEY');

    // Consultamos la lista completa de jobs
    const response = await fetch('https://api.cron-job.org/jobs', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) throw new Error('Error al consultar cron-job.org');

    const data = await response.json();
    
    // Filtramos solo los jobs que nos interesan
    const jobsIds = [
      process.env.CRONJOB_ID_POST,
      process.env.CRONJOB_ID_ODOO
    ];

    const relevantJobs = data.jobs
      .filter((job: any) => jobsIds.includes(String(job.jobId)))
      .map((job: any) => ({
        id: String(job.jobId),
        title: job.title,
        url: job.url,
        lastStatus: job.lastStatus, // Código HTTP de la última ejecución
        lastExecution: job.lastExecution, // Timestamp
        nextExecution: job.nextExecution // Timestamp
      }));

    return res.status(200).json({ jobs: relevantJobs });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
