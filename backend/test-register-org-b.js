async function registerOrgB() {
  try {
    const response = await fetch("http://localhost:5000/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationName: "StockFlow Org B",
        name: "Org B Tester",
        email: "orgb.test@example.com",
        password: "TestPass123!"
      })
    });

    const text = await response.text();
    console.log("HTTP status:", response.status);
    console.log("Server response:", text);
  } catch (error) {
    console.error("Request failed:", error.message);
  }
}

registerOrgB();