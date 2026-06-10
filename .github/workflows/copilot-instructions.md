# AI Rules for AI Flashcard Generator

**Core Problem:** Manually creating high-quality flashcards is extremely time-consuming, creating a barrier that discourages students and individuals from using the highly effective spaced repetition learning method.
**Solution:** A web application that allows users to instantly generate flashcard sets from pasted text using AI, integrated with a built-in study system optimized for exam preparation.
**Target Audience:** High school students, university students, and individuals preparing for exams and certifications.

## FRONTEND

### Guidelines for REACT

#### REACT_CODING_STANDARDS

- Use functional components with hooks instead of class components
- Implement React.memo() for expensive components that render often with the same props
- Utilize React.lazy() and Suspense for code-splitting and performance optimization
- Use the useCallback hook for event handlers passed to child components to prevent unnecessary re-renders
- Prefer useMemo for expensive calculations to avoid recomputation on every render
- Implement useId() for generating unique IDs for accessibility attributes
- Use the new use hook for data fetching in React 19+ projects
- Consider using the new useOptimistic hook for optimistic UI updates in forms
- Use useTransition for non-urgent state updates to keep the UI responsive

### Guidelines for ASTRO

#### ASTRO_CODING_STANDARDS

- Use Astro components (.astro) for static content and layout
- Implement framework components in React only when interactivity is needed
- Leverage View Transitions API for smooth page transitions
- Use content collections with type safety for blog posts, documentation, etc.
- Implement middleware for request/response modification
- Use image optimization with the Astro Image integration
- Leverage Server Endpoints for API routes
- Implement hybrid rendering with server-side rendering where needed
- Use Astro.cookies for server-side cookie management
- Leverage import.meta.env for environment variables

#### ASTRO_ISLANDS

- Use client:visible directive for components that should hydrate when visible in viewport
- Implement shared state with nanostores instead of prop drilling between islands
- Use content collections for type-safe content management of structured content
- Leverage client:media directive for components that should only hydrate at specific breakpoints
- Implement partial hydration strategies to minimize JavaScript sent to the client
- Use client:only for components that should never render on the server
- Leverage client:idle for non-critical UI elements that can wait until the browser is idle
- Implement client:load for components that should hydrate immediately
- Use Astro's transition:\* directives for view transitions between pages
- Leverage props for passing data from Astro to framework components

### Guidelines for STYLING

#### TAILWIND

- Use the @layer directive to organize styles into components, utilities, and base layers
- Implement Just-in-Time (JIT) mode for development efficiency and smaller CSS bundles
- Leverage the @apply directive in component classes to reuse utility combinations
- Implement the Tailwind configuration file for customizing theme, plugins, and variants
- Use component extraction for repeated UI patterns instead of copying utility classes
- Leverage the theme() function in CSS for accessing Tailwind theme values
- Implement dark mode with the dark: variant
- Use responsive variants (sm:, md:, lg:, etc.) for adaptive designs
- Leverage state variants (hover:, focus:, active:, etc.) for interactive elements

### Guidelines for ACCESSIBILITY

#### WCAG_PERCEIVABLE

- Provide text alternatives for non-text content including images, icons, and graphics with appropriate alt attributes
- Maintain minimum contrast ratios of 4.5:1 for normal text and 3:1 for large text and UI components
- Enable content to be presented in different ways without losing information or structure when zoomed or resized
- Provide controls to pause, stop, or hide any moving, blinking, or auto-updating content
- Use responsive design that adapts to different viewport sizes and zoom levels without horizontal scrolling
- Enable users to customize text spacing (line height, paragraph spacing, letter/word spacing) without breaking layouts

#### WCAG_OPERABLE

- Avoid keyboard traps where focus cannot move away from a component via standard navigation
- Avoid content that flashes more than three times per second to prevent seizure triggers
- Implement skip navigation links to bypass blocks of repeated content across pages
- Use descriptive page titles, headings, and link text that indicate purpose and destination
- Ensure focus order matches the visual and logical sequence of information presentation
- Support multiple ways to find content (search, site map, logical navigation hierarchy)
- Allow pointer gesture actions to be accomplished with a single pointer without path-based gestures
- Implement pointer cancellation to prevent unintended function activation, especially for {{critical_actions}}

#### WCAG_UNDERSTANDABLE

- Specify the human language of the page and any language changes using lang attributes
- Implement error prevention for submissions with legal or financial consequences (confirmation, review, undo)
- Make navigation consistent across the site with predictable patterns for menus and interactive elements
- Ensure that receiving focus or changing settings does not automatically trigger unexpected context changes
- Design context-sensitive help for complex interactions including validated input formats
- Provide visual and programmatic indication of current location within navigation systems

#### ARIA

- Use ARIA landmarks to identify regions of the page (main, navigation, search, etc.)
- Apply appropriate ARIA roles to custom interface elements that lack semantic HTML equivalents
- Set aria-expanded and aria-controls for expandable content like accordions and dropdowns
- Use aria-live regions with appropriate politeness settings for dynamic content updates
- Implement aria-hidden to hide decorative or duplicative content from screen readers
- Apply aria-label or aria-labelledby for elements without visible text labels
- Use aria-describedby to associate descriptive text with form inputs or complex elements
- Implement aria-current for indicating the current item in a set, navigation, or process
- Avoid redundant ARIA that duplicates the semantics of native HTML elements

#### WCAG_ROBUST

- Provide name, role, and value information for all user interface components
- Ensure custom controls and interactive elements maintain compatibility with assistive technologies
- Implement status messages that can be programmatically determined without receiving focus
- Use semantic HTML elements that correctly describe the content they contain (buttons, lists, headings, etc.)
- Validate code against technical specifications to minimize compatibility errors
- Test with multiple browsers and assistive technologies for cross-platform compatibility
- Avoid deprecated HTML elements and attributes that may not be supported in future technologies

#### ACCESSIBILITY_TESTING

- Test keyboard navigation to verify all interactive elements are operable without a mouse
- Use automated testing tools like Axe, WAVE, or Lighthouse to identify common accessibility issues
- Check color contrast using tools like Colour Contrast Analyzer for all text and UI components
- Test with page zoomed to 200% to ensure content remains usable and visible
- Perform manual accessibility audits using WCAG 2.2 checklist for key user flows
- Test with voice recognition software like Dragon NaturallySpeaking for voice navigation
- Validate form inputs have proper labels, instructions, and error handling mechanisms
- Conduct usability testing with disabled users representing various disability types
- Implement accessibility unit tests for UI components to prevent regression

#### MOBILE_ACCESSIBILITY

- Ensure touch targets are at least 44 by 44 pixels for comfortable interaction on mobile devices
- Implement proper viewport configuration to support pinch-to-zoom and prevent scaling issues
- Design layouts that adapt to both portrait and landscape orientations without loss of content
- Ensure interactive elements have sufficient spacing to prevent accidental activation
- Test with mobile screen readers like VoiceOver (iOS) and TalkBack (Android)
- Design forms that work efficiently with on-screen keyboards and autocomplete functionality
- Implement alternatives to complex gestures that require fine motor control
- Ensure content is accessible when device orientation is locked for users with fixed devices
- Provide alternatives to motion-based interactions for users with vestibular disorders

## CODING_PRACTICES

### Guidelines for STATIC_ANALYSIS

#### ESLINT

- Configure project-specific rules in eslint.config.js to enforce consistent coding standards
- Use shareable configs like eslint-config-airbnb or eslint-config-standard as a foundation
- Configure integration with Prettier to avoid rule conflicts for code formatting
- Use the --fix flag in CI/CD pipelines to automatically correct fixable issues
- Implement staged linting with husky and lint-staged to prevent committing non-compliant code

#### PRETTIER

- Configure editor integration to format on save for immediate feedback
- Set printWidth based on team preferences (80-120 characters) to improve code readability
- Configure consistent quote style and semicolon usage to match team conventions
- Implement CI checks to ensure all committed code adheres to the defined style

### Guidelines for VERSION_CONTROL

#### CONVENTIONAL_COMMITS

- Follow the format: type(scope): description for all commit messages
- Use consistent types (feat, fix, docs, style, refactor, test, chore) across the project
- Include issue references in commit messages to link changes to requirements
- Use breaking change footer (!: or BREAKING CHANGE:) to clearly mark incompatible changes
- Configure commitlint to automatically enforce conventional commit format
