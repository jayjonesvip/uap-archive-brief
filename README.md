# Official UFO / UAP Archive

A modern, filterable GitHub Pages archive for reviewing government UAP / UFO records from WAR.gov and related official source links.

Live site:

https://jayjonesvip.github.io/official-ufo-release/

## Overview

This project presents government UAP records in a cleaner, easier-to-scan format.

The site loads record data from a JSON file, ranks records by editorial source weight, supports filtering and sorting, and links back to the original official source files. When local image copies are available, the page opens the local image first while still preserving the original source link.

## Features

- Modern dark mode / light mode interface
- Responsive layout for desktop and mobile
- Centered key metric panels
- 5-star source-weight ranking system
- Top panel section showing only 5-star records
- Full archive grid for all records
- Search by title, agency, year, location, source URL, or highlight
- Filter by:
  - Star rating
  - Agency
  - File type
- Sort by:
  - Rating high to low
  - Rating low to high
  - Title A-Z
  - Agency A-Z
  - Year newest first
  - Year oldest first
- Local image support through `localPath`
- Original source links preserved for every record
- GitHub Action update pipeline

## Live Site

The public site is hosted with GitHub Pages:

https://jayjonesvip.github.io/official-ufo-release/

## Project Structure

```txt
official-ufo-release/
├── index.html
├── data/
│   └── release-01-records.json
├── media/
│   └── images/
├── scripts/
│   └── update-records.mjs
├── .github/
│   └── workflows/
│       └── update-uap-records.yml
├── package.json
├── .gitignore
└── README.md
