# 📘 Website Builder UI Blocks Architecture & Technical Specification

> **Complete Developer Reference Document** for modifying, redesigning, and creating UI Block mockups across the Event Management Platform.

---

## 🏗️ Architecture & Data Flow Overview

```mermaid
graph TD
    DB[(MySQL Database)] -->|Sequelize Query| Backend[Express Backend API /api/v1/website-builder/*]
    Backend -->|JSON Response| Proxy[Next.js API Proxy /api/proxy/v1/*]
    Proxy -->|Axios client api.get()| Hooks[React Query Hooks useCompanyWebsiteBuilder.ts]
    Hooks -->|Data Props Mapping| Component[Preview Section Component src/components/company-website-preview/sections/*]
    Component -->|Dynamic Theme Palette| Render[Live Website Preview /website-preview]
```

### Key Request Headers
- `X-Company-Id`: Automatically attached by frontend `apiClient` interceptor (defaults to `1`).

---

## 🎨 Theme System & Color Tokens

All section components receive a `theme` prop containing the active company color palette:

```ts
export type ThemeColors = {
  primaryText: string;    // Main section headings & titles
  primaryButton: string;  // CTA buttons, active tabs, badges, icons, accent dividers
  secondaryText: string;  // Subheaders & secondary labels
  paragraph: string;      // Body copy & description text
};
```

---

## 🧩 Complete UI Blocks Specification

---

### 1. Basic Information (Header)

* **Block Key**: `basic-information`
* **DB Table**: `company_website_basic_information`
* **Columns**:
  - `id` (INT PK)
  - `company_id` (INT)
  - `company_name` (VARCHAR)
  - `logo_url` (TEXT)
  - `header_color` (VARCHAR)
  - `mobile_country_code` (VARCHAR)
  - `mobile` (VARCHAR)
  - `email` (VARCHAR)
  - `address` (TEXT)
  - `show_social_icons` (TINYINT)
  - `show_login` (TINYINT)
  - `show_signin` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/basic-information`
* **Frontend Hook**: `useCompanyBasicInformation()`
* **Preview Component**: `header-section.tsx`

---

### 2. Navigation Menu

* **Block Key**: `nav-menu`
* **DB Table**: `company_website_menu_items`
* **Columns**:
  - `id` (INT PK), `company_id` (INT), `website_id` (INT)
  - `parent_id` (INT, null for top level)
  - `label` (VARCHAR)
  - `url` (VARCHAR)
  - `sort_order` (INT)
  - `is_visible` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/menu-items`
* **Frontend Hook**: `useCompanyMenuItems()`
* **Preview Component**: Rendered inside `header-section.tsx`

---

### 3. Hero Section

* **Block Key**: `hero-section`
* **DB Table**: `company_website_hero_sections`
* **Columns**:
  - `id` (INT PK), `company_id` (INT), `website_id` (INT)
  - `badge_text` (VARCHAR)
  - `title` (VARCHAR)
  - `description` (TEXT)
  - `image_url` (TEXT)
  - `hero_height` (VARCHAR: `small` | `medium` | `large` | `fullscreen`)
  - `overlay_enabled` (TINYINT)
  - `overlay_color` (VARCHAR)
  - `overlay_opacity` (INT 0-100)
  - `button_1_json` (JSON: `{ enabled, label, customUrl, style }`)
  - `button_2_json` (JSON: `{ enabled, label, customUrl, style }`)
  - `content_alignment` (VARCHAR: `left` | `center` | `right`)
* **Backend Endpoint**: `GET /api/v1/website-builder/hero-section`
* **Frontend Hook**: `useCompanyHeroSection()`
* **Preview Component**: `hero-section.tsx`

---

### 4. Homepage Banner Sliders

* **Block Keys**: `advance-slider` | `basic-slider`
* **DB Tables**:
  - `company_website_sliders` (Meta: `animation_speed`, `auto_play`, `height`)
  - `company_website_slider_items` (Individual Slides)
* **Slider Items Columns**:
  - `id`, `company_id`, `slider_id`
  - `title` (VARCHAR)
  - `description` (TEXT)
  - `image_url` (TEXT)
  - `button_label` (VARCHAR), `button_link` (VARCHAR), `button_color` (VARCHAR)
  - `sort_order` (INT), `is_active` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/slider-items`
* **Frontend Hook**: `useCompanySliderItems()`
* **Preview Component**: `slider-section.tsx`

---

### 5. Features Builder

* **Block Key**: `features`
* **DB Table**: `company_website_features`
* **Columns**:
  - `id`, `company_id`, `website_id`
  - `title` (VARCHAR)
  - `short_description` (TEXT)
  - `icon` (VARCHAR: Lucide icon name, e.g., `lucide:layout-dashboard`)
  - `sort_order` (INT), `is_active` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/features`
* **Frontend Hook**: `useCompanyFeatures()`
* **Preview Component**: `features-section.tsx`

---

### 6. How It Works

* **Block Key**: `how-it-works`
* **DB Table**: `company_website_how_it_works`
* **Columns**:
  - `id`, `company_id`, `website_id`
  - `step_number` (INT)
  - `title` (VARCHAR)
  - `description` (TEXT)
  - `icon` (VARCHAR: Lucide icon name)
  - `sort_order` (INT), `is_active` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/how-it-works`
* **Frontend Hook**: `useCompanyHowItWorks()`
* **Preview Component**: `how-it-works-section.tsx`

---

### 7. Event Gallery & Categories

* **Block Keys**: `gallery-images` | `gallery-categories`
* **DB Tables**:
  - `company_website_gallery_categories` (`id`, `name`, `slug`)
  - `company_website_gallery_items` (`id`, `category_id`, `title`, `description`, `image_url`)
* **Backend Endpoints**:
  - `GET /api/v1/website-builder/gallery-categories`
  - `GET /api/v1/website-builder/gallery-items`
* **Frontend Hooks**: `useCompanyGalleryCategories()`, `useCompanyGalleryItems()`
* **Preview Component**: `gallery-section.tsx`

---

### 8. Customer Testimonials

* **Block Key**: `testimonials`
* **DB Table**: `company_website_testimonials`
* **Columns**:
  - `id`, `company_id`
  - `client_name` (VARCHAR)
  - `designation` (VARCHAR)
  - `avatar_url` (TEXT)
  - `rating` (INT 1-5)
  - `testimonial` (TEXT)
  - `sort_order` (INT), `is_active` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/testimonials`
* **Frontend Hook**: `useCompanyTestimonials()`
* **Preview Component**: `testimonials-section.tsx`

---

### 9. Clients Logo Wall

* **Block Key**: `basic-clients`
* **DB Table**: `company_website_clients`
* **Columns**:
  - `id`, `company_id`
  - `client_name` (VARCHAR)
  - `logo_url` (TEXT)
  - `sort_order` (INT), `is_active` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/clients`
* **Frontend Hook**: `useCompanyClients()`
* **Preview Component**: `logo-wall-section.tsx` (`kind="clients"`)

---

### 10. Sponsors Logo Wall

* **Block Key**: `basic-sponsors`
* **DB Table**: `company_website_sponsors`
* **Columns**:
  - `id`, `company_id`
  - `sponsor_name` (VARCHAR)
  - `logo_url` (TEXT)
  - `sort_order` (INT), `is_active` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/sponsors`
* **Frontend Hook**: `useCompanySponsors()`
* **Preview Component**: `logo-wall-section.tsx` (`kind="sponsors"`)

---

### 11. Pricing Plans & Packages

* **Block Key**: `pricing-plans`
* **DB Table**: `company_website_pricing_plans`
* **Columns**:
  - `id`, `company_id`
  - `plan_name` (VARCHAR)
  - `subtitle` (TEXT)
  - `price_monthly` (DECIMAL)
  - `period_label` (VARCHAR)
  - `is_popular` (TINYINT)
  - `features_json` (JSON Array: `["Feature 1", "Feature 2"]`)
  - `sort_order` (INT), `is_active` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/pricing-plans`
* **Frontend Hook**: `useCompanyPricingPlans()`
* **Preview Component**: `pricing-section.tsx`

---

### 12. Event Templates Library

* **Block Key**: `templates`
* **DB Table**: `company_templates` & `company_template_categories`
* **Columns**:
  - `id`, `company_id`, `category_id`
  - `template_name` (VARCHAR)
  - `slug` (VARCHAR)
  - `description` (TEXT)
  - `template_type` (ENUM: `wedding`, `corporate`, `birthday`, `anniversary`)
  - `primary_color` (VARCHAR)
  - `thumbnail_url` (TEXT)
  - `is_popular` (TINYINT), `sort_order` (INT), `is_active` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/templates`
* **Frontend Hook**: `useCompanyTemplates()`
* **Preview Component**: `templates-section.tsx`

---

### 13. FAQs Builder

* **Block Key**: `faqs`
* **DB Table**: `company_website_faqs`
* **Columns**:
  - `id`, `company_id`, `faq_category_id`
  - `question` (TEXT)
  - `answer` (TEXT)
  - `sort_order` (INT), `is_active` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/faqs`
* **Frontend Hook**: `useCompanyFaqs()`
* **Preview Component**: `faqs-section.tsx`

---

### 14. Video Tutorials

* **Block Key**: `video-tutorials`
* **DB Table**: `company_website_video_tutorials`
* **Columns**:
  - `id`, `company_id`
  - `title` (VARCHAR)
  - `short_description` (TEXT)
  - `video_url` (TEXT)
  - `thumbnail_url` (TEXT)
  - `duration_seconds` (INT)
  - `sort_order` (INT), `is_active` (TINYINT)
* **Backend Endpoint**: `GET /api/v1/website-builder/video-tutorials`
* **Frontend Hook**: `useCompanyVideoTutorials()`
* **Preview Component**: `video-tutorials-section.tsx`

---

### 15. Contact Us

* **Block Key**: `contact_us`
* **DB Table**: `company_website_contact_settings` & `company_website_contact_categories`
* **Columns**:
  - `heading`, `subheading`, `address`, `phone`, `email`, `google_map_embed_url`
* **Backend Endpoint**: `GET /api/v1/website-builder/contact-settings`
* **Frontend Hook**: `useCompanyContactSettings()`
* **Preview Component**: `contact-section.tsx`

---

### 16. Footer Settings

* **Block Key**: `footer`
* **DB Table**: `company_website_footer_settings`
* **Columns**:
  - `company_name`, `description`, `copyright_text`, `powered_by_text`
  - `show_newsletter` (TINYINT), `show_social_links` (TINYINT)
  - `quick_links_json` (JSON Array)
* **Backend Endpoint**: `GET /api/v1/website-builder/footer-settings`
* **Frontend Hook**: `useCompanyFooterSettings()`
* **Preview Component**: `footer-section.tsx`

---

### 17. Web UI Block Drag & Drop Ordering

* **Block Key**: `ui-block`
* **DB Table**: `company_website_ui_blocks`
* **Columns**:
  - `id`, `company_id`, `website_id`
  - `block_key` (VARCHAR, e.g. `hero-section`, `features`, `pricing-plans`)
  - `label` (VARCHAR)
  - `is_visible` (TINYINT 1/0)
  - `sort_order` (INT 1-30)
* **Backend Endpoint**: `GET /api/v1/website-builder/company-ui-blocks`
* **Frontend Hook**: `useCompanyUiBlocks()`
* **Preview Orchestrator**: `company-website-preview.tsx`

---

## 🛠️ How to Redesign or Add a New UI Block Section Component

1. **Locate Component File**:
   Open `src/components/company-website-preview/sections/[block-name]-section.tsx`.

2. **Receive Data & Theme**:
   Ensure component receives `theme: ThemeColors` and data array/object.

3. **Apply Theme Styling**:
   ```tsx
   <span style={{ backgroundColor: theme.primaryButton }} className="text-white font-bold">
     Section Pill Badge
   </span>
   <h2 style={{ color: theme.primaryText }} className="text-3xl font-extrabold">
     Heading Title
   </h2>
   ```

4. **Add/Modify Layout**:
   Use Tailwind CSS grid/flex structures (`grid grid-cols-1 md:grid-cols-3 gap-8`).

5. **Register in Orchestrator**:
   In `company-website-preview.tsx`:
   - Add entry to `homeSectionByKey` mapping object.
   - Add key to `defaultHomeOrder` array.

---

### 18. Login & Demo CTA Block Customizer

* **Block Key**: `login-demo`
* **Customizer Route**: `/admin/website-builder/login-demo/[page]`
* **Preview Components File**: `src/components/company-website-preview/sections/login-demo-section.tsx`
* **Variants Specifications**:

| Variant ID | Component Name | Default Page | Design & Layout Features |
| :--- | :--- | :--- | :--- |
| `variant_1` | `LoginDemoSection` | Home Page | Clean row banner with Gift icon circle badge, subtext, Get Started Free & View Demo App buttons. |
| `variant_2` | `FeaturesFirstHighlightSection` | Features Page (1st Demo) | Rich 3-column banner featuring tablet app mockup photo (`/images/event-app-mockup.png`), 2x3 feature pills grid (`Social Media`, `Music Player`, `Countdown Timer`, etc.), and right CTA card. |
| `variant_3` | `ContactSignupDemoSection` | Pricing Page | Dual-card layout: Left Support card (*"Still Have Questions?"* + 3D Headset icon) + Right QR Code phone card (*"Ready to Create Your Amazing Event?"* + QR phone frame + 2 buttons). |
| `variant_4` | `SignupDemoSection` | How It Works Page | Quick walkthrough CTA row banner with Gift icon badge and action buttons. |
| `variant_5` | `ChatSignupDemoSection` | Contact Page | 3D Mail envelope graphic with floating paper plane, *"Still Have Questions?"* headline, Start Live Chat (`MessageSquare`) & Book a Demo (`Calendar`) buttons. |
| `variant_6` | `SignInDemoSection` | Features Page (2nd Demo) | Deep dark slate container (`bg-[#0B0F19]`) with purple/pink theme accent highlight, Create Your App Now & Book a Demo buttons. |
| `variant_7` | `TemplateDemoSection` | Template Page | Custom template builder banner with mobile invitation app mockup, 3 single-row feature checklist badges (*"Fully Customizable"*, *"No Coding Required"*, *"Preview in Real-time"*), Create Custom Template button & View How It Works link. |

