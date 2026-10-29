
import { useEffect, useState } from "react";
import "./App.css";

const API = "https://stackflow-mvp-skxr.onrender.com/api";

export default function App() {
  const [email, setEmail] = useState("test.stockflow@example.com");
  const [password, setPassword] = useState("TestPass123!");
  const [token, setToken] = useState("");
  const [products, setProducts] = useState([]);
  const [dashboard, setDashboard] = useState({});
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    name: "",
    sku: "",
    quantity: 0,
    price: 0,
    low_stock_threshold: 5
  });

  async function request(path, options = {}, authToken = token) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(authToken
          ? { Authorization: `Bearer ${authToken}` }
          : {}),
        ...options.headers
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Request failed");
    }

    return data;
  }

  async function login(event) {
    event.preventDefault();

    try {
      const data = await request(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password })
        },
        ""
      );

      setToken(data.token);
      setMessage("Login successful!");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadData(authToken) {
    const [productData, dashboardData] = await Promise.all([
      request("/products", {}, authToken),
      request("/dashboard", {}, authToken)
    ]);

    setProducts(
      Array.isArray(productData)
        ? productData
        : productData.products || []
    );

    setDashboard(dashboardData);
  }

  useEffect(() => {
    if (!token) return;

    loadData(token).catch(error => setMessage(error.message));
  }, [token]);

  async function addProduct(event) {
    event.preventDefault();

    try {
      await request("/products", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          quantity: Number(form.quantity),
          price: Number(form.price),
          low_stock_threshold: Number(form.low_stock_threshold)
        })
      });

      await loadData(token);

      setMessage("Product added successfully!");

      setForm({
        name: "",
        sku: "",
        quantity: 0,
        price: 0,
        low_stock_threshold: 5
      });
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteProduct(id) {
    if (!window.confirm("Delete this product?")) return;

    try {
      await request(`/products/${id}`, { method: "DELETE" });
      await loadData(token);
      setMessage("Product deleted successfully!");
    } catch (error) {
      setMessage(error.message);
    }
  }

  if (!token) {
    return (
      <main className="login-page">
        <form className="login-card" onSubmit={login}>
          <h1>StockFlow</h1>
          <p>Inventory management made simple</p>

          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />

          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          <button type="submit">Sign in</button>

          <small>
            {message || "Sign in to manage your inventory."}
          </small>
        </form>
      </main>
    );
  }

  const totalUnits =
    dashboard.totalUnits ??
    products.reduce(
      (sum, product) => sum + Number(product.quantity || 0),
      0
    );

  const lowStockCount =
    dashboard.lowStockCount ??
    products.filter(
      product =>
        Number(product.quantity) <=
        Number(product.low_stock_threshold)
    ).length;

  return (
    <main className="app">
      <aside className="sidebar">
        <h2>StockFlow</h2>
        <p className="side-label">WORKSPACE</p>

        <div className="active">▦ &nbsp; Dashboard</div>
        <div>▤ &nbsp; Products</div>
        <div>⚙ &nbsp; Settings</div>

        <button
          className="signout"
          onClick={() => {
            setToken("");
            setMessage("Signed out");
          }}
        >
          Sign out
        </button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>Inventory Dashboard</h1>
            <p>Here's what's happening with your stock today.</p>
          </div>

          <div className="avatar">
            {email.charAt(0).toUpperCase()}
          </div>
        </header>

        {message && <p className="message">{message}</p>}

        <section className="stats">
          <article className="stat-card">
            <span>Total Products</span>
            <strong>
              {dashboard.totalProducts ?? products.length}
            </strong>
          </article>

          <article className="stat-card">
            <span>Total Units</span>
            <strong>{totalUnits}</strong>
          </article>

          <article className="stat-card">
            <span>Inventory Value</span>
            <strong>
              ₹{Number(
                dashboard.inventoryValue || 0
              ).toLocaleString("en-IN")}
            </strong>
          </article>

          <article className="stat-card">
            <span>Low Stock Items</span>
            <strong>{lowStockCount}</strong>
          </article>
        </section>

        <section className="panel">
          <h2>Add a Product</h2>

          <form className="product-form" onSubmit={addProduct}>
            <input
              placeholder="Product name"
              value={form.name}
              onChange={e =>
                setForm({ ...form, name: e.target.value })
              }
              required
            />

            <input
              placeholder="SKU"
              value={form.sku}
              onChange={e =>
                setForm({ ...form, sku: e.target.value })
              }
              required
            />

            <input
              type="number"
              min="0"
              placeholder="Quantity"
              value={form.quantity}
              onChange={e =>
                setForm({ ...form, quantity: e.target.value })
              }
              required
            />

            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Price (₹)"
              value={form.price}
              onChange={e =>
                setForm({ ...form, price: e.target.value })
              }
              required
            />

            <input
              type="number"
              min="0"
              placeholder="Low-stock threshold"
              value={form.low_stock_threshold}
              onChange={e =>
                setForm({
                  ...form,
                  low_stock_threshold: e.target.value
                })
              }
              required
            />

            <button type="submit">+ Add Product</button>
          </form>
        </section>

        <section className="panel">
          <h2>Product Inventory</h2>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Quantity</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {products.map(product => {
                  const isLow =
                    Number(product.quantity) <=
                    Number(product.low_stock_threshold);

                  return (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.sku}</td>
                      <td>{product.quantity}</td>
                      <td>
                        ₹{Number(product.price).toLocaleString("en-IN")}
                      </td>
                      <td>
                        <span className={isLow ? "low" : "good"}>
                          {isLow ? "Low Stock" : "In Stock"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="delete"
                          onClick={() => deleteProduct(product.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {products.length === 0 && (
                  <tr>
                    <td colSpan="6">
                      No products found. Add your first product.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
