resource "aws_s3_bucket" "orders" {
  bucket = "pm-example-orders-prod"
}

resource "aws_s3_bucket_versioning" "orders" {
  bucket = aws_s3_bucket.orders.id
  versioning_configuration {
    status = "Enabled"
  }
}
