const express = require('express');
const router = express.Router();

const timezones = [
  { value: "Pacific/Midway", label: "Midway Island (GMT-11:00)", offset: -11 },
  { value: "Pacific/Honolulu", label: "Hawaii (GMT-10:00)", offset: -10 },
  { value: "America/Anchorage", label: "Alaska (GMT-09:00)", offset: -9 },
  { value: "America/Los_Angeles", label: "Pacific Time - US & Canada (GMT-08:00)", offset: -8 },
  { value: "America/Denver", label: "Mountain Time - US & Canada (GMT-07:00)", offset: -7 },
  { value: "America/Chicago", label: "Central Time - US & Canada (GMT-06:00)", offset: -6 },
  { value: "America/New_York", label: "Eastern Time - US & Canada (GMT-05:00)", offset: -5 },
  { value: "America/Caracas", label: "Caracas (GMT-04:30)", offset: -4.5 },
  { value: "America/Halifax", label: "Atlantic Time - Canada (GMT-04:00)", offset: -4 },
  { value: "America/Sao_Paulo", label: "Brasilia (GMT-03:00)", offset: -3 },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (GMT-03:00)", offset: -3 },
  { value: "Atlantic/South_Georgia", label: "Mid-Atlantic (GMT-02:00)", offset: -2 },
  { value: "Atlantic/Azores", label: "Azores (GMT-01:00)", offset: -1 },
  { value: "UTC", label: "UTC (GMT+00:00)", offset: 0 },
  { value: "Europe/London", label: "London, Edinburgh (GMT+00:00)", offset: 0 },
  { value: "Europe/Paris", label: "Paris, Brussels, Madrid (GMT+01:00)", offset: 1 },
  { value: "Europe/Berlin", label: "Berlin, Amsterdam, Rome (GMT+01:00)", offset: 1 },
  { value: "Africa/Lagos", label: "West Central Africa (GMT+01:00)", offset: 1 },
  { value: "Europe/Athens", label: "Athens, Istanbul (GMT+02:00)", offset: 2 },
  { value: "Africa/Cairo", label: "Cairo (GMT+02:00)", offset: 2 },
  { value: "Africa/Johannesburg", label: "Johannesburg (GMT+02:00)", offset: 2 },
  { value: "Europe/Moscow", label: "Moscow, St. Petersburg (GMT+03:00)", offset: 3 },
  { value: "Asia/Kuwait", label: "Kuwait, Riyadh (GMT+03:00)", offset: 3 },
  { value: "Africa/Nairobi", label: "Nairobi (GMT+03:00)", offset: 3 },
  { value: "Asia/Tehran", label: "Tehran (GMT+03:30)", offset: 3.5 },
  { value: "Asia/Dubai", label: "Dubai, Abu Dhabi (GMT+04:00)", offset: 4 },
  { value: "Asia/Baku", label: "Baku (GMT+04:00)", offset: 4 },
  { value: "Asia/Kabul", label: "Kabul (GMT+04:30)", offset: 4.5 },
  { value: "Asia/Karachi", label: "Karachi, Islamabad (GMT+05:00)", offset: 5 },
  { value: "Asia/Tashkent", label: "Tashkent (GMT+05:00)", offset: 5 },
  { value: "Asia/Kolkata", label: "Mumbai, Kolkata, New Delhi (GMT+05:30)", offset: 5.5 },
  { value: "Asia/Colombo", label: "Sri Lanka (GMT+05:30)", offset: 5.5 },
  { value: "Asia/Kathmandu", label: "Kathmandu (GMT+05:45)", offset: 5.75 },
  { value: "Asia/Dhaka", label: "Dhaka (GMT+06:00)", offset: 6 },
  { value: "Asia/Almaty", label: "Almaty (GMT+06:00)", offset: 6 },
  { value: "Asia/Yangon", label: "Yangon (GMT+06:30)", offset: 6.5 },
  { value: "Asia/Bangkok", label: "Bangkok, Jakarta (GMT+07:00)", offset: 7 },
  { value: "Asia/Ho_Chi_Minh", label: "Ho Chi Minh (GMT+07:00)", offset: 7 },
  { value: "Asia/Shanghai", label: "Beijing, Shanghai (GMT+08:00)", offset: 8 },
  { value: "Asia/Hong_Kong", label: "Hong Kong (GMT+08:00)", offset: 8 },
  { value: "Asia/Singapore", label: "Singapore (GMT+08:00)", offset: 8 },
  { value: "Asia/Taipei", label: "Taipei (GMT+08:00)", offset: 8 },
  { value: "Australia/Perth", label: "Perth (GMT+08:00)", offset: 8 },
  { value: "Asia/Tokyo", label: "Tokyo, Osaka (GMT+09:00)", offset: 9 },
  { value: "Asia/Seoul", label: "Seoul (GMT+09:00)", offset: 9 },
  { value: "Australia/Adelaide", label: "Adelaide (GMT+09:30)", offset: 9.5 },
  { value: "Australia/Sydney", label: "Sydney, Melbourne (GMT+10:00)", offset: 10 },
  { value: "Pacific/Guam", label: "Guam (GMT+10:00)", offset: 10 },
  { value: "Asia/Vladivostok", label: "Vladivostok (GMT+10:00)", offset: 10 },
  { value: "Pacific/Auckland", label: "Auckland, Wellington (GMT+12:00)", offset: 12 },
  { value: "Pacific/Fiji", label: "Fiji (GMT+12:00)", offset: 12 },
  { value: "Pacific/Tongatapu", label: "Nuku'alofa (GMT+13:00)", offset: 13 },
];

// Public route - no auth required
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: { timezones },
  });
});

module.exports = router;
