/* Which Inventra API this page talks to.
   Opened from localhost (python serve.py): the local backend on 127.0.0.1:8000.
   Opened from anywhere else (the hosted site): HOSTED_API below.
   Any page can still override it with ?api=https://host in the URL. */
const HOSTED_API = 'https://inventra-api-wyqe.onrender.com';   // the backend on Render

window.INVENTRA_API = window.INVENTRA_API ||
  (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8000' : HOSTED_API);
