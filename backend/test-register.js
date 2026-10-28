async function testDashboard() {
  try {
    const login = await fetch("http://localhost:5000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
          email: "test.stockflow@example.com",
          password: "TestPass123!"
       
      })
    });

    const loginData = await login.json();

    if (!login.ok || !loginData.token) {
      console.log("Login failed:", loginData);
      return;
    }

    const response = await fetch("http://localhost:5000/api/dashboard", {
      headers: {
        Authorization: `Bearer ${loginData.token}`
      }
    });

    console.log("Dashboard status:", response.status);
    console.log(await response.text());
  } catch (error) {
    console.log("Error:", error.message);
  }
}

testDashboard();
