<template>
  <div class="flex flex-col space-y-3">
    <LegoColorsHeader />

    <ErrorBoundary>
      <Suspense>
        <LegoColorsList />
      </Suspense>
    </ErrorBoundary>
  </div>
</template>
