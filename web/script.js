// Web client component - Next.js/React with Tailwind (client side only)
// This is a placeholder; actual implementation may depend on other JSX files.
import { useState, useEffect } from 'react';

function App() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  
  // Mock data fetching (replace with real API later)
  useEffect(() => {
    fetch('/api/menu')
      .then(r => r.json())
      .then(data => { setItems(data); });
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100 p-4">
      <h1 className="text-3xl font-bold mb-4">Catering Menu</h1>
      
      {items.map((item, i) => (
        <div key={i} className="border rounded-md shadow-sm p-2 text-center">
          <h2>{item.name}</h2>
          <p>${item.price * item.quantity}</p>
          <input 
            type="number" 
            min={1} max={5}
            value={item.quantity}
            onChange={(e) => {
              setItems(prev =>
                prev.map((it, idx) => (idx === i ? { ...it, quantity: e.target.value } : it))
              )
            }} 
          />
        </div>
      ))}
      
      <button 
        className="mt-4 bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
        onClick={() => {
          const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
          // Simulate sending deep link
          window.location.href = `https://wa.me/15005551234?text=Confirm%20Order%2Ctotal=${total}`;
        }}
      >
        Confirm Order via WhatsApp
      </button>
    </div>
  );
}
export default App;
window.App = App;
