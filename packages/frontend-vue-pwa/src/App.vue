<template>
  <main class="page">
    <header class="header">
      <h1>imbiro</h1>
      <p class="lede">Vue 3 + PWA · API na Express + Postgres</p>
    </header>

    <section class="card">
      <p class="muted">Pusty projekt — gotowy na nowe moduły.</p>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 40rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #e8e8ef;
  min-height: 100vh;
  box-sizing: border-box;
  background: linear-gradient(165deg, #12121a 0%, #1a1a2e 45%, #16213e 100%);
}

.header h1 {
  margin: 0 0 0.35rem;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.lede {
  margin: 0;
  color: #9b9bb8;
  font-size: 0.95rem;
}

.card {
  margin-top: 1.75rem;
  padding: 1.25rem 1.35rem;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
}

.card h2 {
  margin: 0 0 1rem;
  font-size: 1.1rem;
  font-weight: 600;
}

.muted {
  margin: 0;
  color: #8a8aa3;
  font-size: 0.9rem;
}
</style>
