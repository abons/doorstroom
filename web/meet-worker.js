// Vóór/na-metingen buiten de hoofdthread: op een telefoon kost één meting tientallen seconden rekenwerk, en dan
// moet de kaart gewoon blijven reageren. Eén opdracht per worker; app.js beëindigt hem bij een nieuwe meting.
import { meetScenario } from './meet.js';

self.onmessage = async ({ data }) => {
  const r = await meetScenario(data.kaart, data.routes, data.opties, (f) => { self.postMessage({ f }); });
  self.postMessage({ klaar: r });
};
