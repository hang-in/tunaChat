import { test, expect } from './fixtures';

test.describe('앱 기본 로드', () => {
  test('앱이 렌더되고 헤더가 표시됨', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header').locator('text=tunaChat')).toBeVisible({ timeout: 10000 });
  });

  test('검색 인풋이 헤더에 표시됨', async ({ page }) => {
    await page.goto('/');
    const searchInput = page.locator('input[placeholder="메시지 검색..."]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
  });
});

test.describe('검색 기능', () => {
  test('Escape 키로 검색어 초기화', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    const searchInput = page.locator('input[placeholder="메시지 검색..."]');
    await searchInput.fill('테스트');
    await expect(searchInput).toHaveValue('테스트');
    await searchInput.press('Escape');
    await expect(searchInput).toHaveValue('');
  });
});
