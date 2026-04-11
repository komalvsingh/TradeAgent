const API_URL = process.env.VITE_API_URL;

export const getDecision = async () => {
  const res = await fetch(`${API_URL}/decision`);
  return res.json();
};