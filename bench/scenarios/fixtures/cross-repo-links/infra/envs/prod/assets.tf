resource "aws_s3_bucket" "webshop_assets" {
  bucket = "pm-example-webshop-assets"
}

output "webshop_assets_bucket" {
  value = aws_s3_bucket.webshop_assets.bucket
}
